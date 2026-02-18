import { readFileSync, readdirSync, rmSync, statSync } from "fs";
import { dirname, resolve, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { DefaultMutableDirectBuffer } from "./agrona-ts/src/index.js";
import { XMLParser } from "fast-xml-parser";
import { runGenerator, type GeneratorResult } from "./generator.js";
import { pruneSchemaToMessage } from "./schema-prune.js";

export type DecodeArgs = {
    schema?: string;
    encodedMessage?: string;
    messageId?: number;
};

type GeneratedConstructor<T = unknown> = new (...args: Array<unknown>) => T;
type HeaderDecoderConstructor = GeneratedConstructor<{
    wrap: (buffer: DefaultMutableDirectBuffer, offset: number) => void;
    templateId: () => number;
    blockLength: () => number;
    version: () => number;
}> & {
    ENCODED_LENGTH: number;
};

const isLogEnabled = process.env.SBE_LOG === "1";
const log = (...args: unknown[]) => {
    if (isLogEnabled) {
        console.log("[sbe-decode]", ...args);
    }
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(
    __dirname,
    __dirname.includes(`${sep}dist${sep}`) ? "../../.." : "../..",
);

export async function decodeFromInput(args: DecodeArgs): Promise<Record<string, unknown>> {
    if (!args.schema || !args.encodedMessage) {
        throw new Error("schema and encodedMessage are required.");
    }

    let schemaXml = resolveSchemaInput(args.schema);
    let messageId = args.messageId;
    if (messageId == null) {
        messageId = extractTemplateId(args.encodedMessage);
    }
    if (messageId != null) {
        schemaXml = pruneSchemaToMessage(schemaXml, messageId);
        log("pruned-schema", { messageId, schemaBytes: schemaXml.length });
    }
    log("start", {
        messageId,
        schemaBytes: schemaXml.length,
        encodedLength: args.encodedMessage.length,
    });
    const generatorResult = await runGenerator(schemaXml);
    try {
        const result = await decodeMessage(args.encodedMessage, schemaXml, messageId, generatorResult);
        log("done", { decodedFields: Object.keys(result.decodedFields ?? {}).length });
        return result;
    } finally {
        cleanupGeneratedCodecs(generatorResult.codecsDir);
    }
}

export async function decodeMessage(
    encodedMessage: string,
    schemaXml: string,
    messageId: number | undefined,
    generatorResult: GeneratorResult,
): Promise<Record<string, unknown>> {
    const schema = parseSchema(schemaXml);
    const debug = process.env.SBE_DEBUG_DECODE === "1";
    const log = (...args: unknown[]) => {
        if (debug) {
            console.log("[sbe-decode]", ...args);
        }
    };

    ensureTextDecoderEncoding();
    const indexPath = findGeneratedIndex(generatorResult.codecsDir);
    const codecs = await importGeneratedCodecs(indexPath);

    const bytes = decodeMessageBytes(encodedMessage);
    const buffer = new DefaultMutableDirectBuffer(bytes.length);
    buffer.wrap(bytes);

    const MessageHeaderDecoder = codecs.MessageHeaderDecoder as HeaderDecoderConstructor | undefined;
    if (!MessageHeaderDecoder) {
        throw new Error("Generated codecs missing MessageHeaderDecoder.");
    }

    const headerDecoder = new MessageHeaderDecoder();
    headerDecoder.wrap(buffer, 0);

    const headerTemplateId = headerDecoder.templateId();
    const headerBlockLength = headerDecoder.blockLength();
    const headerVersion = headerDecoder.version();
    const manualBlockLength = bytes[0] | (bytes[1] << 8);
    const manualTemplateId = bytes[2] | (bytes[3] << 8);
    const manualVersion = bytes[6] | (bytes[7] << 8);

    let templateId = headerTemplateId;
    let blockLength = headerBlockLength;
    let version = headerVersion;
    if (headerTemplateId !== manualTemplateId) {
        console.warn(
            `[sbe-decode] header mismatch: decoder=${headerTemplateId} manual=${manualTemplateId}; using manual`,
        );
        templateId = manualTemplateId;
        blockLength = manualBlockLength;
        version = manualVersion;
    }

    const headerMessage = schema.messagesById.get(String(templateId));
    const effectiveMessageId = headerMessage ? templateId : messageId ?? templateId;
    const message = schema.messagesById.get(String(effectiveMessageId));
    if (!message) {
        throw new Error(`Message id ${effectiveMessageId} not found in schema.`);
    }

    const decoderName = `${message.name}Decoder`;
    const MessageDecoder = codecs[decoderName] as GeneratedConstructor<Record<string, unknown>> | undefined;
    if (!MessageDecoder) {
        throw new Error(`Generated codecs missing ${decoderName}.`);
    }

    log("header", { templateId, blockLength, version, messageName: message.name });
    log("encodedBytes", bytes.length);
    log("nodes", message.nodes.length);

    const decoder = new MessageDecoder();
    if (typeof decoder.wrap === "function") {
        decoder.wrap(buffer, MessageHeaderDecoder.ENCODED_LENGTH, blockLength, version);
    } else if (typeof decoder.wrapAndApplyHeader === "function") {
        decoder.wrapAndApplyHeader(buffer, 0, headerDecoder);
    } else {
        throw new Error(`Decoder ${decoderName} does not expose wrap methods.`);
    }

    const decodedFields: Record<string, unknown> = {};
    const actingVersion = typeof decoder.actingVersion === "function" ? decoder.actingVersion() : version;
    let inVariableSection = false;

    for (const node of message.nodes) {
        if (node.kind === "data") {
            inVariableSection = true;
        }
        if (node.kind === "group") {
            const entries = readGroup(decoder, node);
            if (entries.length > 0) {
                decodedFields[node.id] = entries;
            }
            continue;
        }

        const methodName = lowerFirst(node.name);
        const sinceVersionMethod = decoder[`${methodName}SinceVersion`] as (() => number) | undefined;
        if (typeof sinceVersionMethod === "function" && actingVersion < sinceVersionMethod.call(decoder)) {
            continue;
        }

        try {
            if (node.kind === "data") {
                const value = readDataField(decoder, node.name);
                if (value !== undefined) {
                    decodedFields[node.id] = value;
                }
            } else {
                const getter = decoder[methodName] as (() => unknown) | undefined;
                if (typeof getter !== "function") {
                    continue;
                }
                const value = getter.call(decoder);
                decodedFields[node.id] = value;
            }
        } catch (err) {
            if (
                err instanceof Error &&
                (/boundsCheck/i.test(err.message) || /index=\d+/i.test(err.message))
            ) {
                if (inVariableSection) {
                    break;
                }
                continue;
            }
            throw err;
        }
    }

    const filteredFields = filterDecodedFields(decodedFields);
    const fixMessage = buildFixMessage(message.nodes, filteredFields);

    return {
        messageId: effectiveMessageId,
        decodedFields: filteredFields,
        fixMessage,
    };
}

function ensureTextDecoderEncoding(): void {
    const globalAny = globalThis as unknown as {
        TextDecoder?: typeof TextDecoder;
    };
    if (!globalAny.TextDecoder) return;

    const OriginalTextDecoder = globalAny.TextDecoder;
    globalAny.TextDecoder = class PatchedTextDecoder extends OriginalTextDecoder {
        constructor(label?: string, options?: TextDecoderOptions) {
            const normalized = label === "UTF_8" ? "utf-8" : label;
            super(normalized, options);
        }
    };
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
};

function parseSchema(schemaXml: string): ParsedSchema {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
        preserveOrder: true,
    });
    const nodes = parser.parse(schemaXml) as Array<Record<string, unknown>>;
    const messagesById = new Map<string, MessageDef>();

    for (const node of nodes) {
        const schemaNode = node.messageSchema as unknown;
        if (!schemaNode) continue;
        const schemaChildren = Array.isArray(schemaNode) ? schemaNode : Object.values(schemaNode as object);

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
    }

    return { messagesById };
}

function buildFixMessage(orderedFields: MessageNode[], decoded: Record<string, unknown>): string {
    const parts: string[] = [];
    appendNodesToFix(parts, orderedFields, decoded);
    return parts.join("|");
}

function filterDecodedFields(decoded: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(decoded)) {
        if (raw === null || raw === undefined) continue;
        if (Array.isArray(raw)) {
            if (raw.length === 0) continue;
            filtered[key] = raw;
            continue;
        }
        if (typeof raw === "string") {
            const trimmed = raw.trim();
            if (trimmed.length === 0) continue;
            if (isZeroString(trimmed)) continue;
        }
        if (typeof raw === "number" && (Number.isNaN(raw) || raw === 0)) continue;
        if (typeof raw === "bigint" && raw === 0n) continue;
        filtered[key] = raw;
    }
    return filtered;
}

function isZeroString(value: string): boolean {
    return /^0+(?:\.0+)?$/.test(value);
}

function appendNodesToFix(
    parts: string[],
    nodes: MessageNode[],
    decoded: Record<string, unknown>,
): void {
    for (const node of nodes) {
        if (node.kind === "group") {
            const entries = decoded[node.id];
            if (!Array.isArray(entries) || entries.length === 0) {
                continue;
            }
            parts.push(`${node.id}=${entries.length}`);
            for (const entry of entries) {
                if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                    appendGroupEntry(parts, node, entry as Record<string, unknown>);
                }
            }
            continue;
        }

        const raw = decoded[node.id];
        if (!shouldIncludeFixValue(raw)) continue;
        parts.push(`${node.id}=${stringifyFixValue(raw, node)}`);
    }
}

function appendGroupEntry(
    parts: string[],
    group: MessageGroupNode,
    entry: Record<string, unknown>,
): void {
    for (const child of group.children) {
        if (child.kind === "group") {
            const nested = entry[child.id];
            if (!Array.isArray(nested) || nested.length === 0) {
                continue;
            }
            parts.push(`${child.id}=${nested.length}`);
            for (const nestedEntry of nested) {
                if (nestedEntry && typeof nestedEntry === "object" && !Array.isArray(nestedEntry)) {
                    appendGroupEntry(parts, child, nestedEntry as Record<string, unknown>);
                }
            }
            continue;
        }

        const raw = entry[child.id];
        if (!shouldIncludeFixValue(raw)) continue;
        parts.push(`${child.id}=${stringifyFixValue(raw, child)}`);
    }
}

function shouldIncludeFixValue(raw: unknown): boolean {
    if (raw === null || raw === undefined) return false;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.length === 0) return false;
        if (isZeroString(trimmed)) return false;
    }
    if (typeof raw === "number" && (Number.isNaN(raw) || raw === 0)) return false;
    if (typeof raw === "bigint" && raw === 0n) return false;
    return true;
}

function stringifyFixValue(raw: unknown, node: MessageNode): string {
    if (typeof raw === "bigint") {
        const value = raw.toString();
        if (node.kind === "field" && (node.semanticType === "UTCTimestamp" || node.semanticType === "TZTimestamp")) {
            const formatted = formatFixTimestamp(value);
            return formatted ?? value;
        }
        return value;
    }
    return String(raw);
}

function formatFixTimestamp(value: string): string | null {
    if (!/^\d{17}$/.test(value)) return null;
    if (!value.startsWith("20")) return null;
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(8, 10);
    const minute = value.slice(10, 12);
    const second = value.slice(12, 14);
    const millis = value.slice(14, 17);
    return `${year}${month}${day}-${hour}:${minute}:${second}.${millis}`;
}

function resolveSchemaInput(schema: string): string {
    const trimmed = schema.trim();
    if (trimmed.startsWith("<")) {
        return schema;
    }
    const resolved = resolve(process.cwd(), schema);
    return readFileSync(resolved, "utf8");
}

function readDataField(decoder: Record<string, unknown>, fieldName: string): string | undefined {
    const methodName = lowerFirst(fieldName);
    const lengthMethod = decoder[`${methodName}Length`] as (() => number) | undefined;
    const getterToArray = decoder[`get${capitalize(fieldName)}ToArray`] as
        | ((dst: Uint8Array, dstOffset: number, length: number) => number)
        | undefined;

    if (typeof lengthMethod !== "function" || typeof getterToArray !== "function") {
        return undefined;
    }

    let length: number;
    try {
        length = lengthMethod.call(decoder);
    } catch (err) {
        if (err instanceof Error && (/boundsCheck/i.test(err.message) || /index=\d+/i.test(err.message))) {
            return undefined;
        }
        throw err;
    }
    if (length <= 0) {
        getterToArray.call(decoder, new Uint8Array(0), 0, 0);
        return "";
    }

    const bytes = new Uint8Array(length);
    const copied = getterToArray.call(decoder, bytes, 0, length);
    const textDecoder = new TextDecoder("utf-8");
    return textDecoder.decode(bytes.subarray(0, copied));
}

function capitalize(value: string): string {
    if (!value) return value;
    return value[0].toUpperCase() + value.slice(1);
}

function decodeMessageBytes(encodedMessage: string): Uint8Array {
    let cleaned = encodedMessage.trim();
    if (cleaned.startsWith("0x") || cleaned.startsWith("0X")) {
        cleaned = cleaned.slice(2);
    }
    const isHexOnly = /^[0-9a-fA-F]+$/.test(cleaned);
    if (isHexOnly && cleaned.length % 2 === 1) {
        cleaned = `0${cleaned}`;
    }
    const isHex = isHexOnly;
    const buffer = isHex ? Buffer.from(cleaned, "hex") : Buffer.from(cleaned, "base64");
    return new Uint8Array(buffer);
}

function extractTemplateId(encodedMessage: string): number | undefined {
    try {
        const bytes = decodeMessageBytes(encodedMessage);
        if (bytes.length < 4) return undefined;
        return bytes[2] | (bytes[3] << 8);
    } catch {
        return undefined;
    }
}

function cleanupGeneratedCodecs(codecsDir: string): void {
    try {
        rmSync(codecsDir, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
    }
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

function readGroup(decoder: Record<string, unknown>, group: MessageGroupNode): Array<Record<string, unknown>> {
    const accessor = decoder[lowerFirst(group.name)] as (() => Record<string, unknown>) | undefined;
    if (typeof accessor !== "function") {
        return [];
    }
    const groupDecoder = accessor.call(decoder);
    if (!groupDecoder || typeof groupDecoder !== "object") {
        return [];
    }
    const countMethod = groupDecoder["count"] as (() => number) | undefined;
    const count = typeof countMethod === "function" ? countMethod.call(groupDecoder) : 0;
    if (!Number.isFinite(count) || count <= 0) {
        return [];
    }
    const entries: Array<Record<string, unknown>> = [];
    for (let i = 0; i < count; i++) {
        if (typeof groupDecoder["next"] === "function") {
            groupDecoder["next"]();
        }
        const entry: Record<string, unknown> = {};
        for (const child of group.children) {
            if (child.kind === "group") {
                entry[child.id] = readGroup(groupDecoder, child);
                continue;
            }
            if (child.kind === "data") {
                const value = readDataField(groupDecoder, child.name);
                if (value !== undefined) {
                    entry[child.id] = value;
                }
                continue;
            }
            const getter = groupDecoder[lowerFirst(child.name)] as (() => unknown) | undefined;
            if (typeof getter !== "function") continue;
            entry[child.id] = getter.call(groupDecoder);
        }
        entries.push(entry);
    }
    return entries;
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
