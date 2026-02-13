import { createServer } from "http";

import { decodeFromInput, type DecodeArgs } from "@fixdescriptorkit/ts-sdk/sbe/decode";
import { encodeFromInput, type Args as EncodeArgs } from "@fixdescriptorkit/ts-sdk/sbe/encode";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

type JsonValue = Record<string, unknown>;

const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const logPrefix = `[sbe-node] ${req.method ?? "?"} ${url.pathname}`;
    console.log(`${logPrefix} start`);
    if (req.method !== "POST") {
        safeJson(res, 405, { error: "Only POST supported." });
        console.log(`${logPrefix} end`, { status: 405, durationMs: Date.now() - started });
        return;
    }

    try {
        if (url.pathname === "/encode") {
            const body = (await readJson(req)) as EncodeArgs;
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
            safeJson(res, 200, {
                encodedBytes: encoded.length,
                encodedHex: Buffer.from(encoded).toString("hex"),
            });
            console.log(`${logPrefix} end`, { status: 200, durationMs: Date.now() - started });
            return;
        }

        if (url.pathname === "/decode") {
            const body = (await readJson(req)) as DecodeArgs;
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
            safeJson(res, 200, result);
            console.log(`${logPrefix} end`, { status: 200, durationMs: Date.now() - started });
            return;
        }

        safeJson(res, 404, { error: "Not found." });
        console.log(`${logPrefix} end`, { status: 404, durationMs: Date.now() - started });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        safeJson(res, 500, { error: message });
        console.log(`${logPrefix} end`, { status: 500, durationMs: Date.now() - started, error: message });
    }
});

server.listen(port, () => {
    console.log(`[sbe-node] listening on ${port}`);
});

function readJson(req: NodeJS.ReadableStream, maxBytes = 10 * 1024 * 1024): Promise<JsonValue> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;

        req.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > maxBytes) {
                reject(new Error("Request body too large."));
                return;
            }
            chunks.push(buffer);
        });

        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve(JSON.parse(raw) as JsonValue);
            } catch (err) {
                reject(err);
            }
        });

        req.on("error", reject);
    });
}

function safeJson(res: NodeJS.WritableStream & { writeHead?: Function; end?: Function; writableEnded?: boolean; headersSent?: boolean }, status: number, body: JsonValue): void {
    if ("writableEnded" in res && res.writableEnded) {
        return;
    }
    if ("headersSent" in res && res.headersSent) {
        return;
    }
    if (typeof res.writeHead === "function") {
        res.writeHead(status, { "content-type": "application/json" });
    }
    if (typeof res.end === "function") {
        const json = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
        res.end(json);
    }
}
