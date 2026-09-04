import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TareDiffReport } from "../diff/diffTypes.js";
import { baseReport, headReport } from "./fixtures/diffReportFixtures.js";
import { tempDir } from "./testUtils.js";

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

describe("tare-mcp diff CLI", () => {
  it("keeps existing root and diff CLI commands wired", async () => {
    const rootHelp = await runCli(["--help"]);
    const diffHelp = await runCli(["diff", "--help"]);

    expect(rootHelp.code).toBe(0);
    expect(rootHelp.stdout).toContain("Usage: tare-mcp [options]");
    expect(rootHelp.stdout).toContain("diff");
    expect(diffHelp.code).toBe(0);
    expect(diffHelp.stdout).toContain("Usage: tare-mcp diff [options]");
    expect(diffHelp.stdout).toContain("--max-token-increase");
  });

  it("outputs pure JSON and exits 1 when thresholds fail", async () => {
    const dir = await tempDir();
    try {
      const basePath = path.join(dir.path, "base.json");
      const headPath = path.join(dir.path, "head.json");
      await writeFile(basePath, JSON.stringify(baseReport()), "utf8");
      await writeFile(headPath, JSON.stringify(headReport()), "utf8");

      const result = await runCli([
        "diff",
        "--base",
        basePath,
        "--head",
        headPath,
        "--json",
        "--max-token-increase",
        "1000"
      ]);
      const parsed = JSON.parse(result.stdout) as TareDiffReport;

      expect(result.code).toBe(1);
      expect(result.stderr).toBe("");
      expect(parsed.thresholds[0]).toMatchObject({
        flag: "--max-token-increase",
        actual: 1800,
        exceeded: true
      });
    } finally {
      await dir.cleanup();
    }
  });

  it("never claims no regression when an OpenAI-token threshold fails", async () => {
    const dir = await tempDir();
    try {
      const base = baseReport();
      const head = baseReport();
      head.summary.estimatedTokens.openaiCl100k += 100;
      const basePath = path.join(dir.path, "base.json");
      const headPath = path.join(dir.path, "head.json");
      await writeFile(basePath, JSON.stringify(base), "utf8");
      await writeFile(headPath, JSON.stringify(head), "utf8");

      const result = await runCli([
        "diff",
        "--base",
        basePath,
        "--head",
        headPath,
        "--json",
        "--tokenizer",
        "openai",
        "--max-token-increase",
        "50"
      ]);
      const parsed = JSON.parse(result.stdout) as TareDiffReport;

      expect(result.code).toBe(1);
      expect(parsed.thresholds[0]).toMatchObject({
        tokenizer: "openai",
        actual: 100,
        exceeded: true
      });
      expect(parsed.recommendations).toContainEqual({
        type: "budget",
        message: "Review the largest token increases before merging this MCP config change."
      });
      expect(parsed.recommendations.map((entry) => entry.message).join("\n")).not.toContain(
        "No MCP context regression"
      );
    } finally {
      await dir.cleanup();
    }
  });

  it("exits 2 for invalid diff input", async () => {
    const result = await runCli([
      "diff",
      "/tmp/tare-missing-base.json",
      "/tmp/tare-missing-head.json"
    ]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("FAILED: invalid tare-mcp report.");
    expect(result.stderr).toContain("was not found");
  });
});

function runCli(args: string[]): Promise<CliResult> {
  const cliPath = path.join(import.meta.dirname, "..", "cli.ts");
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" },
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
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
