import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServerEnv, inspectStdioServer } from "../inspectors/stdioMcpInspector.js";
import type { NormalizedServer } from "../inspectors/types.js";
import { eventually, fixturePath, readMaybe, tempDir } from "./testUtils.js";

function stdioServer(overrides: Partial<NormalizedServer> = {}): NormalizedServer {
  return {
    name: "fake",
    command: process.execPath,
    args: [fixturePath("fakeStdioServer.mjs")],
    sourceConfigPath: "/tmp/mcp.json",
    transport: "stdio",
    ...overrides
  };
}

describe("inspectStdioServer", () => {
  it("collects tools/list pagination across multiple pages", async () => {
    const result = await inspectStdioServer(stdioServer(), { timeoutMs: 2000 });

    expect(result.inspectionMode).toBe("live");
    expect(result.toolDefinitions.map((tool) => tool.name)).toEqual([
      "search_code",
      "create_issue"
    ]);
  });

  it("falls back on timeout", async () => {
    const result = await inspectStdioServer(
      stdioServer({ args: [fixturePath("fakeStdioServer.mjs"), "--delay"] }),
      {
        timeoutMs: 50
      }
    );

    expect(result.inspectionMode).toBe("fallback-static-insufficient");
    expect(result.warnings.join("\n")).toContain("live inspection failed after");
    expect(result.confidence).toBe("low");
  });

  it("closes/kills transport on timeout", async () => {
    const dir = await tempDir();
    const pidFile = path.join(dir.path, "pid");

    try {
      await inspectStdioServer(
        stdioServer({
          args: [fixturePath("fakeStdioServer.mjs"), "--delay"],
          env: { FAKE_MCP_PID_FILE: pidFile }
        }),
        { timeoutMs: 200 }
      );

      let pid = Number(await readMaybe(pidFile));
      await eventually(async () => {
        pid = Number(await readMaybe(pidFile));
        expect(Number.isFinite(pid)).toBe(true);
      });
      expect(Number.isFinite(pid)).toBe(true);
      await eventually(() => {
        expect(() => process.kill(pid, 0)).toThrow();
      });
    } finally {
      await dir.cleanup();
    }
  });

  it("inspector handles server that requires credentials and fails gracefully", async () => {
    const result = await inspectStdioServer(
      stdioServer({
        args: [fixturePath("authFailureServer.mjs")],
        env: { SECRET_TOKEN: "super-secret-token" }
      }),
      { timeoutMs: 1000 }
    );

    const serialized = JSON.stringify(result);
    expect(result.inspectionMode).toBe("fallback-static-insufficient");
    expect(result.warnings.join("\n")).toMatch(/credentials|startup/);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).toContain("[REDACTED]");
  });

  it("does not forward tare's own env vars to spawned stdio MCP server processes", () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousTare = process.env.TARE_CLAUDE_TOKENIZER;
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.TARE_CLAUDE_TOKENIZER = "api";

    try {
      const env = buildServerEnv(stdioServer({ env: { SERVER_TOKEN: "server-secret" } }));
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.TARE_CLAUDE_TOKENIZER).toBeUndefined();
      expect(env.SERVER_TOKEN).toBe("server-secret");
    } finally {
      if (previousAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropic;
      }

      if (previousTare === undefined) {
        delete process.env.TARE_CLAUDE_TOKENIZER;
      } else {
        process.env.TARE_CLAUDE_TOKENIZER = previousTare;
      }
    }
  });

  it("does not forward host secrets that were not explicitly configured", () => {
    const previousGithubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "host-only-secret";

    try {
      const env = buildServerEnv(stdioServer({ env: { SERVER_TOKEN: "server-secret" } }));
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.SERVER_TOKEN).toBe("server-secret");
    } finally {
      if (previousGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousGithubToken;
      }
    }
  });
});
