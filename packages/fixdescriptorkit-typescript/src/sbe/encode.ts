import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { dirname, resolve, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { runGenerator, type GeneratorResult } from "./generator.js";
import { DefaultMutableDirectBuffer } from "./agrona-ts/src/index.js";
import { XMLParser } from "fast-xml-parser";
import { pruneSchemaToMessage } from "./schema-prune.js";

export type Args = {
    schema?: string;
    fixMessage?: string;
    messageId?: number;
};

type GeneratedConstructor<T = unknown> = new (...args: Array<unknown>) => T;
type MessageHeaderEncoderLike = Record<string, unknown>;
type MessageEncoderLike = {
    wrapAndApplyHeader: (buffer: DefaultMutableDirectBuffer, offset: number, headerEncoder: MessageHeaderEncoderLike) => void;
    getLimit: () => number;
} & Record<string, unknown>;

const isLogEnabled = process.env.SBE_LOG === "1";
const log = (...args: unknown[]) => {
    if (isLogEnabled) {
        console.log("[sbe-encode]", ...args);
    }
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(
    __dirname,
    __dirname.includes(`${sep}dist${sep}`) ? "../../.." : "../..",
);

export async function encodeFromInput(args: Args): Promise<Uint8Array> {
    if (!args.schema || !args.fixMessage || args.messageId == null) {
        throw new Error("schema, fixMessage, and messageId are required.");
    }

    let schemaXml = resolveSchemaInput(args.schema);
    schemaXml = pruneSchemaToMessage(schemaXml, args.messageId);
    log("pruned-schema", { messageId: args.messageId, schemaBytes: schemaXml.length });
    log("start", { messageId: args.messageId, schemaBytes: schemaXml.length });
    const generatorResult = await runGenerator(schemaXml);
    try {
        const result = await encodeMessage(args.fixMessage, args.messageId, schemaXml, generatorResult);
        log("done", { encodedBytes: result.length });
        return result;
    } finally {
        cleanupGeneratedCodecs(generatorResult.codecsDir);
    }
}

export async function encodeMessage(
    fixMessage: string,
    messageId: number,
    schemaXml: string,
    generatorResult: GeneratorResult,
): Promise<Uint8Array> {
    const schema = parseSchema(schemaXml);
    const message = schema.messagesById.get(String(messageId));
    if (!message) {
        throw new Error(`Message id ${messageId} not found in schema.`);
    }

    const loadStart = Date.now();
    log("load-codecs start", { codecsDir: generatorResult.codecsDir });
    const indexPath = findGeneratedIndex(generatorResult.codecsDir);
    const codecs = await importGeneratedCodecs(indexPath);
    log("load-codecs done", { indexPath, durationMs: Date.now() - loadStart });

    const messageEncoderName = `${message.name}Encoder`;
    const MessageHeaderEncoder = codecs.MessageHeaderEncoder as GeneratedConstructor<MessageHeaderEncoderLike> | undefined;
    const MessageEncoder = codecs[messageEncoderName] as GeneratedConstructor<MessageEncoderLike> | undefined;

    if (!MessageHeaderEncoder || !MessageEncoder) {
        throw new Error(`Generated codecs missing ${messageEncoderName} or MessageHeaderEncoder.`);
    }

    const buffer = new DefaultMutableDirectBuffer(1024 + fixMessage.length * 4);
    const headerEncoder = new MessageHeaderEncoder();
    const encoder = new MessageEncoder();

    const encodeStart = Date.now();
    encoder.wrapAndApplyHeader(buffer, 0, headerEncoder);

    const tokens = parseFixTokens(fixMessage);
    const groupIds = collectGroupIds(message.nodes);
    const scalarValues = buildScalarMap(tokens, groupIds);
    log("encode-fields start", {
        tokenCount: tokens.length,
        groupCount: groupIds.size,
        nodeCount: message.nodes.length,
    });

    // Encode fields/groups in schema order.
    for (const node of message.nodes) {
        if (node.kind === "field") {
            const raw = scalarValues.get(node.id);
            if (raw === undefined) continue;
            setFieldValue(encoder, node, raw, schema.typeByName);
            continue;
        }
        if (node.kind === "data") {
            const raw = scalarValues.get(node.id) ?? "";
            setDataValue(encoder, node, raw);
            continue;
        }
        if (node.kind === "group") {
            const entries = parseGroupEntries(tokens, node);
            encodeGroupEntries(encoder, node, entries, schema.typeByName);
        }
    }

    const length = encoder.getLimit();
    log("encode-fields done", { durationMs: Date.now() - encodeStart, encodedBytes: length });
    return buffer.byteArray().slice(0, length);
}

type MessageFieldNode = {
    kind: "field";
    id: string;
    name: string;
    type: string;
    semanticType?: string;
};

type MessageDataNode = {
    kind: "data";
    id: string;
    name: string;
    type: string;
};

type MessageGroupNode = {
    kind: "group";
    id: string;
    name: string;
    children: MessageNode[];
};

type MessageNode = MessageFieldNode | MessageDataNode | MessageGroupNode;

type MessageDef = {
    name: string;
    nodes: MessageNode[];
};

type ParsedSchema = {
    messagesById: Map<string, MessageDef>;
    typeByName: Map<string, string>;
};

function parseSchema(schemaXml: string): ParsedSchema {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
        allowBooleanAttributes: true,
    });
    const parsed = parser.parse(schemaXml);
    const schema = parsed.messageSchema ?? parsed["sbe:messageSchema"] ?? parsed;

    const typeByName = new Map<string, string>();
    const typesNode = schema.types ?? {};
    for (const type of toArray(typesNode.type)) {
        if (type?.name && type?.primitiveType) {
            typeByName.set(String(type.name), String(type.primitiveType));
        }
    }
    for (const en of toArray(typesNode.enum)) {
        if (en?.name && en?.encodingType) {
            typeByName.set(String(en.name), String(en.encodingType));
        }
    }

    const messagesById = new Map<string, MessageDef>();
    const orderParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
        preserveOrder: true,
    });
    const nodes = orderParser.parse(schemaXml) as Array<Record<string, unknown>>;
    const schemaNode = nodes.find((node) => node.messageSchema) as
        | { messageSchema?: unknown }
        | undefined;
    if (!schemaNode?.messageSchema) {
        return { messagesById, typeByName };
    }

    const schemaChildren = Array.isArray(schemaNode.messageSchema)
        ? schemaNode.messageSchema
        : Object.values(schemaNode.messageSchema as object);

    for (const child of schemaChildren as Array<Record<string, unknown>>) {
        if (!child.message) continue;
        const messageAttrs = (child[":@"] ?? {}) as Record<string, string>;
        const id = messageAttrs.id;
        const name = messageAttrs.name;
        if (!id || !name) continue;

        const messageChildren = toChildArray(child.message);
        const nodesForMessage = parseMessageNodes(messageChildren);
        messagesById.set(String(id), { name: String(name), nodes: nodesForMessage });
    }

    return { messagesById, typeByName };
}

function toArray<T>(value: T | T[] | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function parseFixTokens(fixMessage: string): Array<{ tag: string; value: string }> {
    const normalized = fixMessage.replace(/\u0001/g, "|");
    const tokens: Array<{ tag: string; value: string }> = [];
    for (const part of normalized.split("|")) {
        if (!part) continue;
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        const tag = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (tag) tokens.push({ tag, value });
    }
    return tokens;
}

function lowerFirst(value: string): string {
    if (!value) return value;
    return value[0].toLowerCase() + value.slice(1);
}

function toChildArray(value: unknown): Array<Record<string, unknown>> {
    if (!value) return [];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    if (typeof value === "object") return Object.values(value as object) as Array<Record<string, unknown>>;
    return [];
}

function parseMessageNodes(nodes: Array<Record<string, unknown>>): MessageNode[] {
    const result: MessageNode[] = [];
    for (const node of nodes) {
        if (node.field) {
            const attrs = (node[":@"] ?? {}) as Record<string, string>;
            if (attrs.id && attrs.name && attrs.type) {
                result.push({
                    kind: "field",
                    id: String(attrs.id),
                    name: String(attrs.name),
                    type: String(attrs.type),
                    semanticType: attrs.semanticType ? String(attrs.semanticType) : undefined,
                });
            }
            continue;
        }
        if (node.data) {
            const attrs = (node[":@"] ?? {}) as Record<string, string>;
            if (attrs.id && attrs.name && attrs.type) {
                result.push({ kind: "data", id: String(attrs.id), name: String(attrs.name), type: String(attrs.type) });
            }
            continue;
        }
        if (node.group) {
            const attrs = (node[":@"] ?? {}) as Record<string, string>;
            if (!attrs.id || !attrs.name) continue;
            const children = parseMessageNodes(toChildArray(node.group));
            result.push({
                kind: "group",
                id: String(attrs.id),
                name: String(attrs.name),
                children,
            });
        }
    }
    return result;
}

function collectGroupIds(nodes: MessageNode[], into: Set<string> = new Set()): Set<string> {
    for (const node of nodes) {
        if (node.kind === "group") {
            into.add(node.id);
            collectGroupIds(node.children, into);
        }
    }
    return into;
}

function buildScalarMap(tokens: Array<{ tag: string; value: string }>, groupIds: Set<string>): Map<string, string> {
    const values = new Map<string, string>();
    for (const token of tokens) {
        if (groupIds.has(token.tag)) continue;
        if (!values.has(token.tag)) {
            values.set(token.tag, token.value);
        }
    }
    return values;
}

function parseGroupEntries(
    tokens: Array<{ tag: string; value: string }>,
    group: MessageGroupNode,
    startIndex: number = 0,
): Array<Record<string, unknown>> {
    const idx = findNextTokenIndex(tokens, group.id, startIndex);
    if (idx === -1) return [];
    const count = Number.parseInt(tokens[idx].value, 10);
    if (!Number.isFinite(count) || count <= 0) return [];

    const entries: Array<Record<string, unknown>> = [];
    let cursor = idx + 1;
    for (let i = 0; i < count; i++) {
        const entry: Record<string, unknown> = {};
        for (const child of group.children) {
            if (child.kind === "group") {
                const nested = parseGroupEntries(tokens, child, cursor);
                entry[child.id] = nested;
                const nextIdx = findNextTokenIndex(tokens, child.id, cursor);
                if (nextIdx !== -1) {
                    cursor = nextIdx + 1;
                }
                continue;
            }
            const nextIdx = findNextTokenIndex(tokens, child.id, cursor);
            if (nextIdx === -1) continue;
            entry[child.id] = tokens[nextIdx].value;
            cursor = nextIdx + 1;
        }
        entries.push(entry);
    }
    return entries;
}

function encodeGroupEntries(
    encoder: Record<string, unknown>,
    group: MessageGroupNode,
    entries: Array<Record<string, unknown>>,
    typeByName: Map<string, string>,
): void {
    const countMethodName = `${lowerFirst(group.name)}Count`;
    const countMethod = encoder[countMethodName] as ((count: number) => unknown) | undefined;
    if (typeof countMethod !== "function") {
        return;
    }
    const groupEncoder = countMethod.call(encoder, entries.length) as Record<string, unknown>;
    if (!groupEncoder) return;

    for (const entry of entries) {
        if (typeof groupEncoder.next === "function") {
            groupEncoder.next();
        }
        for (const child of group.children) {
            if (child.kind === "group") {
                const nestedEntries = entry[child.id] as Array<Record<string, unknown>> | undefined;
                if (nestedEntries) {
                    encodeGroupEntries(groupEncoder, child, nestedEntries, typeByName);
                }
                continue;
            }
            const raw = entry[child.id];
            if (raw === undefined) continue;
            if (child.kind === "field") {
                setFieldValue(groupEncoder, child, String(raw), typeByName);
            } else {
                setDataValue(groupEncoder, child, String(raw));
            }
        }
    }
}

function findNextTokenIndex(
    tokens: Array<{ tag: string; value: string }>,
    tag: string,
    startIndex: number,
): number {
    for (let i = startIndex; i < tokens.length; i++) {
        if (tokens[i].tag === tag) return i;
    }
    return -1;
}

function setFieldValue(
    target: Record<string, unknown>,
    field: MessageFieldNode,
    raw: string,
    typeByName: Map<string, string>,
): void {
    const methodName = lowerFirst(field.name);
    const setter = target[methodName] as ((value: unknown) => void) | undefined;
    if (typeof setter !== "function") return;
    const coerced = coerceValue(raw, field.type, field.semanticType, typeByName);
    setter.call(target, coerced);
}

function setDataValue(target: Record<string, unknown>, field: MessageDataNode, raw: string): void {
    const methodName = lowerFirst(field.name);
    const setter = target[methodName] as ((value: unknown) => void) | undefined;
    if (typeof setter === "function") {
        setter.call(target, raw);
        return;
    }
    const arraySetter = target[`put${field.name}ToArray`] as
        | ((src: Array<number>, srcOffset: number, length: number) => void)
        | undefined;
    if (typeof arraySetter === "function") {
        const bytes = new TextEncoder().encode(raw);
        arraySetter.call(target, Array.from(bytes), 0, bytes.length);
    }
}

function resolveSchemaInput(schema: string): string {
    const trimmed = schema.trim();
    if (trimmed.startsWith("<")) {
        return schema;
    }
    const resolved = resolve(process.cwd(), schema);
    return readFileSync(resolved, "utf8");
}

function coerceValue(
    rawValue: string,
    fieldType: string,
    semanticType: string | undefined,
    typeByName: Map<string, string>,
): string | number | bigint {
    const primitive = resolvePrimitiveType(fieldType, typeByName);
    if (!primitive) {
        return rawValue;
    }

    if (primitive === "char") {
        if (rawValue.length === 1 && isNaN(Number(rawValue))) {
            return rawValue.charCodeAt(0);
        }
        return Number.parseInt(rawValue, 10);
    }

    if (primitive === "float" || primitive === "double") {
        return Number.parseFloat(rawValue);
    }

    if (primitive === "int64" || primitive === "uint64") {
        if (
            (semanticType === "UTCTimestamp" || semanticType === "TZTimestamp") &&
            (rawValue.includes("-") || rawValue.includes(":"))
        ) {
            const digits = rawValue.replace(/\D/g, "");
            if (digits.length > 0) {
                return BigInt(digits);
            }
        }
        if (rawValue.includes(".")) {
            const scaled = Math.round(Number.parseFloat(rawValue) * 1e8);
            return BigInt(scaled);
        }
        return BigInt(rawValue);
    }

    if (primitive.startsWith("int") || primitive.startsWith("uint")) {
        return Number.parseInt(rawValue, 10);
    }

    return rawValue;
}

function cleanupGeneratedCodecs(codecsDir: string): void {
    try {
        rmSync(codecsDir, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
    }
}

function resolvePrimitiveType(typeName: string, typeByName: Map<string, string>): string | null {
    if (
        typeName === "char" ||
        typeName === "int8" ||
        typeName === "int16" ||
        typeName === "int32" ||
        typeName === "int64" ||
        typeName === "uint8" ||
        typeName === "uint16" ||
        typeName === "uint32" ||
        typeName === "uint64" ||
        typeName === "float" ||
        typeName === "double"
    ) {
        return typeName;
    }

    return typeByName.get(typeName) ?? null;
}

function findGeneratedIndex(codecsDir: string): string {
    const rootDir = resolve(codecsDir);
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        for (const entry of readdirSync(current)) {
            const fullPath = resolve(current, entry);
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry === "index.g.js" || entry === "index.g.ts") {
                return fullPath;
            }
        }
    }

    throw new Error("Generated codecs index.g.{ts,js} not found.");
}

async function importGeneratedCodecs(indexPath: string): Promise<Record<string, unknown>> {
    const url = pathToFileURL(indexPath).href;
    const module = await import(`${url}?t=${Date.now()}`);
    return module as Record<string, unknown>;
}
