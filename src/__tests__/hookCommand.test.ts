import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./testUtils.js";

type CliResult = { code: number; stdout: string; stderr: string };

function runCli(
  args: string[],
  stdinData?: string,
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<CliResult> {
  const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1", HOME: repoRoot, ...envOverrides },
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
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

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

  it("includes cached Claude connector tools in emitted telemetry", async () => {
    const home = await tempDir();
    const requests: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });

    try {
      const sessionDirectory = path.join(
        home.path,
        "Library",
        "Application Support",
        "Claude",
        "claude-code-sessions"
      );
      await mkdir(sessionDirectory, { recursive: true });
      await writeFile(
        path.join(sessionDirectory, "session.json"),
        JSON.stringify({
          remoteMcpServersConfig: [
            {
              uuid: "gmail-id",
              name: "gmail",
              tools: [
                {
                  name: "search_mail",
                  description: "Search mail",
                  inputSchema: { type: "object" }
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      const endpoint = await listen(server);
      const result = await runCli(["hook"], '{"session_id":"connector-session"}', {
        HOME: home.path,
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint
      });

      expect(result.code).toBe(0);
      expect(requests).toHaveLength(1);
      const payload = JSON.parse(requests[0] ?? "{}") as {
        resourceLogs?: Array<{
          scopeLogs?: Array<{
            logRecords?: Array<{
              attributes?: Array<{ key: string; value: { intValue?: string } }>;
            }>;
          }>;
        }>;
      };
      const attributes = Object.fromEntries(
        (payload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.attributes ?? []).map(
          (attribute) => [attribute.key, attribute.value]
        )
      );
      expect(attributes.servers).toEqual({ intValue: "1" });
      expect(attributes.tools).toEqual({ intValue: "1" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await home.cleanup();
    }
  });

  it("rejects a partially numeric TARE_HOOK_BUDGET value", async () => {
    await new Promise<void>((resolveTest, rejectTest) => {
      const server = createServer((req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");

          try {
            const payload = JSON.parse(body) as { resourceLogs?: unknown[] };
            const logRecords = ((
              payload.resourceLogs as Array<{ scopeLogs?: Array<{ logRecords?: unknown[] }> }>
            )?.[0]?.scopeLogs?.[0]?.logRecords ?? []) as Array<{
              attributes?: Array<{ key: string }>;
            }>;

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
          TARE_HOOK_BUDGET: "12abc",
          HOME: repoRoot
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
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const result = await new Promise<CliResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected HTTP test server address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
