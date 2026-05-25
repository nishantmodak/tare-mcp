import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CliResult = { code: number; stdout: string; stderr: string };

function runCli(args: string[], stdinData?: string): Promise<CliResult> {
  const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (stdinData !== undefined) {
    child.stdin.write(stdinData);
    child.stdin.end();
  } else {
    child.stdin.end();
  }

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("tare-mcp hook CLI", () => {
  it("registers hook subcommand — shows in root help", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hook");
  });

  it("hook --help describes the subcommand", async () => {
    const result = await runCli(["hook", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: tare-mcp hook");
    expect(result.stdout).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  it("TARE_HOOK_BUDGET=abc (NaN) does not emit budget_tokens attribute", async () => {
    await new Promise<void>((resolveTest, rejectTest) => {
      const server = createServer((req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");

          try {
            const payload = JSON.parse(body) as { resourceLogs?: unknown[] };
            const logRecords = (
              (payload.resourceLogs as Array<{ scopeLogs?: Array<{ logRecords?: unknown[] }> }>)?.[0]
                ?.scopeLogs?.[0]?.logRecords ?? []
            ) as Array<{ attributes?: Array<{ key: string }> }>;

            const allKeys = logRecords.flatMap((r) => (r.attributes ?? []).map((a) => a.key));
            expect(allKeys).not.toContain("budget_tokens");
            resolveTest();
          } catch (err) {
            rejectTest(err);
          } finally {
            server.close();
          }
        });
      });

      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        const endpoint = `http://127.0.0.1:${port}`;

        const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
        const repoRoot = path.join(import.meta.dirname, "..", "..");
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          NO_COLOR: "1",
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          TARE_HOOK_BUDGET: "abc"
        };

        const child = spawn(process.execPath, ["--import", "tsx", cliPath, "hook"], {
          cwd: repoRoot,
          env,
          stdio: ["pipe", "pipe", "pipe"]
        });

        child.stdin.write('{"session_id":"nan-budget-test"}');
        child.stdin.end();
        child.on("error", rejectTest);
        child.on("close", () => {});
      });
    });
  });

  it("hook exits 0 and warns when OTEL_EXPORTER_OTLP_ENDPOINT is not set", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
    const repoRoot = path.join(import.meta.dirname, "..", "..");
    const child = spawn(process.execPath, ["--import", "tsx", cliPath, "hook"], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdin.write('{"session_id":"test-session"}');
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const result = await new Promise<CliResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  });
});
