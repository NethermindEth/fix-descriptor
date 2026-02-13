import { decodeFromInput, type DecodeArgs } from "@fixdescriptorkit/ts-sdk/sbe/decode";
import { encodeFromInput, type Args as EncodeArgs } from "@fixdescriptorkit/ts-sdk/sbe/encode";

type LambdaEvent = {
    rawPath?: string;
    body?: string | null;
    isBase64Encoded?: boolean;
    requestContext?: {
        http?: {
            method?: string;
            path?: string;
        };
    };
};

type LambdaResult = {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
};

type JsonValue = Record<string, unknown>;

export async function lambdaHandler(event: LambdaEvent): Promise<LambdaResult> {
    const started = Date.now();
    const method = event.requestContext?.http?.method ?? "POST";
    const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
    const logPrefix = `[sbe-node] ${method} ${path}`;

    console.log(`${logPrefix} start`);

    if (method !== "POST") {
        const result = jsonResponse(405, { error: "Only POST supported." });
        console.log(`${logPrefix} end`, { status: 405, durationMs: Date.now() - started });
        return result;
    }

    try {
        if (path === "/encode") {
            const body = parseJsonBody(event) as EncodeArgs;
            console.log(`${logPrefix} body`, {
                schemaBytes: typeof body.schema === "string" ? body.schema.length : null,
                fixBytes: typeof body.fixMessage === "string" ? body.fixMessage.length : null,
                messageId: body.messageId,
            });
            const encoded = await encodeFromInput({
                schema: body.schema,
                fixMessage: body.fixMessage,
                messageId: body.messageId,
            });
            const result = jsonResponse(200, {
                encodedBytes: encoded.length,
                encodedHex: Buffer.from(encoded).toString("hex"),
            });
            console.log(`${logPrefix} end`, { status: 200, durationMs: Date.now() - started });
            return result;
        }

        if (path === "/decode") {
            const body = parseJsonBody(event) as DecodeArgs;
            console.log(`${logPrefix} body`, {
                schemaBytes: typeof body.schema === "string" ? body.schema.length : null,
                encodedBytes: typeof body.encodedMessage === "string" ? body.encodedMessage.length : null,
                messageId: body.messageId,
            });
            const result = await decodeFromInput({
                schema: body.schema,
                encodedMessage: body.encodedMessage,
                messageId: body.messageId,
            });
            const response = jsonResponse(200, result as JsonValue);
            console.log(`${logPrefix} end`, { status: 200, durationMs: Date.now() - started });
            return response;
        }

        const notFound = jsonResponse(404, { error: "Not found." });
        console.log(`${logPrefix} end`, { status: 404, durationMs: Date.now() - started });
        return notFound;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const failed = jsonResponse(500, { error: message });
        console.log(`${logPrefix} end`, { status: 500, durationMs: Date.now() - started, error: message });
        return failed;
    }
}

function parseJsonBody(event: LambdaEvent, maxBytes = 10 * 1024 * 1024): JsonValue {
    const raw = event.body ?? "";
    const bodyString = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    if (Buffer.byteLength(bodyString, "utf8") > maxBytes) {
        throw new Error("Request body too large.");
    }
    return JSON.parse(bodyString) as JsonValue;
}

function jsonResponse(statusCode: number, body: JsonValue): LambdaResult {
    const json = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: json,
    };
}
