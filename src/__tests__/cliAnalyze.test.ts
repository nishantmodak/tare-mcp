import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TareReport } from "../analysis/types.js";
import { tempDir } from "./testUtils.js";

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

describe("tare-mcp analyze CLI", () => {
  it("includes selected-tokenizer budget metadata in JSON reports", async () => {
    const home = await tempDir();
    try {
      const claudeDir = path.join(home.path, ".claude");
      await mkdir(claudeDir, { recursive: true });
      await writeFile(
        path.join(claudeDir, "mcp.json"),
        JSON.stringify({ mcpServers: { example: { command: "example-mcp" } } }),
        "utf8"
      );

      const result = await runCli(
        ["--no-exec", "--json", "--budget", "1", "--tokenizer", "openai"],
        home.path
      );
      const report = JSON.parse(result.stdout) as TareReport;

      expect(result.code).toBe(1);
      expect(report.metadata).toMatchObject({
        budgetExceeded: true,
        budgetTokens: 1,
        budgetTokenizer: "openai"
      });
    } finally {
      await home.cleanup();
    }
  });
});

function runCli(args: string[], home: string): Promise<CliResult> {
  const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

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
