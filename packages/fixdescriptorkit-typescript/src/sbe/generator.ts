import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export type GeneratorResult = {
    codecsDir: string;
    namespace: string;
};

const isLogEnabled = process.env.SBE_LOG === "1";
const log = (...args: unknown[]) => {
    if (isLogEnabled) {
        console.log("[sbe-generator]", ...args);
    }
};
let javaVersionLogged = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve package root directly: from src/sbe -> ../.. = package root
const packageRoot = resolve(__dirname, "../..");

export function findLocalJar(): string {
    // lib folder is part of the published package, resolve directly
    return resolve(packageRoot, "lib", "sbe-all.jar");
}

export async function runGenerator(schemaXml: string): Promise<GeneratorResult> {
    const started = Date.now();
    const jarPath = findLocalJar();

    // Lambda containers allow writing to /tmp; avoid writing under package/node_modules paths.
    // Use secure temporary directory API to avoid conflicts and ensure proper permissions
    const outputDir = mkdtempSync(join(tmpdir(), "sbe-codecs-"));
    const schemaPath = resolveSchemaPath(schemaXml, outputDir);
    const javaCmd = process.env.JAVA || "java";
    if (isLogEnabled && !javaVersionLogged) {
        javaVersionLogged = true;
        const versionCheck = spawnSync(javaCmd, ["-version"], { encoding: "utf8" });
        log("java", {
            cmd: javaCmd,
            status: versionCheck.status,
            stderr: versionCheck.stderr?.toString().trim(),
            stdout: versionCheck.stdout?.toString().trim(),
        });
    }
    const cmdArgs = [
        `-Dsbe.output.dir=${outputDir}`,
        "-Dsbe.target.language=TypeScript",
        "-Dsbe.target.namespace=fix",
        "-cp",
        jarPath,
        "uk.co.real_logic.sbe.SbeTool",
        schemaPath,
    ];

    log("start", {
        jarPath,
        outputDir,
        schemaPath,
        schemaBytes: schemaXml.length,
        cmd: [javaCmd, ...cmdArgs].join(" "),
    });
    const result = spawnSync(javaCmd, cmdArgs, { stdio: "inherit" });
    log("exit", { status: result.status, durationMs: Date.now() - started });
    if (result.status !== 0) {
        throw new Error(`sbe-ts: generator failed with status ${result.status ?? "unknown"}`);
    }

    if (isLogEnabled) {
        const topLevel = readdirSync(outputDir);
        log("output", {
            outputDir,
            entries: topLevel.slice(0, 50),
            entryCount: topLevel.length,
        });
    }

    return { codecsDir: outputDir, namespace: "fix" };
}

function resolveSchemaPath(schemaXml: string, outputDir: string): string {
    const trimmed = schemaXml.trim();
    if (trimmed.startsWith("<")) {
        const path = join(outputDir, "schema.xml");
        writeFileSync(path, schemaXml);
        return path;
    }
    return schemaXml;
}
