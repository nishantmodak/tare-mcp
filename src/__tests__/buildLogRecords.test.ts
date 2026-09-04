import { describe, expect, it } from "vitest";
import { buildLogRecords } from "../hook/buildLogRecords.js";
import type { TareReport } from "../analysis/types.js";

function makeReport(overrides: Partial<TareReport> = {}): TareReport {
  return {
    version: "0.3.0",
    generatedAt: "2026-05-25T00:00:00.000Z",
    summary: {
      configFiles: 1,
      servers: 2,
      tools: 10,
      estimatedTokens: { claude: 5000, openaiCl100k: 4800 },
      contextWindows: {
        "64000": { claude: 8, openaiCl100k: 8 },
        "128000": { claude: 4, openaiCl100k: 4 },
        "200000": { claude: 3, openaiCl100k: 2 }
      },
      insufficientServers: 0
    },
    servers: [],
    overlapClusters: [],
    recommendations: [],
    warnings: [],
    metadata: { staticOnly: false, inspectionMode: "live default" },
    ...overrides
  };
}

describe("buildLogRecords", () => {
  it("emits one INFO record when no budget or overlap", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "s1" });
    expect(records).toHaveLength(1);
    expect(records[0].body.stringValue).toBe("mcp.tool_surface");
    expect(records[0].severityText).toBe("INFO");
    expect(records[0].severityNumber).toBe(9);
  });

  it("includes correct mcp.tool_surface attributes", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "s1" });
    const attrs = Object.fromEntries(records[0].attributes.map((a) => [a.key, a.value]));
    expect(attrs["servers"]).toEqual({ intValue: "2" });
    expect(attrs["tools"]).toEqual({ intValue: "10" });
    expect(attrs["tokens_claude"]).toEqual({ intValue: "5000" });
    expect(attrs["tokens_openai_cl100k"]).toEqual({ intValue: "4800" });
    expect(attrs["overlap_clusters"]).toEqual({ intValue: "0" });
    expect(attrs["budget_exceeded"]).toEqual({ boolValue: false });
    expect(attrs["claude.session_id"]).toEqual({ stringValue: "s1" });
  });

  it("omits budget_tokens when no budget is set", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "" });
    const keys = records[0].attributes.map((a) => a.key);
    expect(keys).not.toContain("budget_tokens");
  });

  it("includes budget_tokens when budget is set", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "", budget: 40000 });
    const attrs = Object.fromEntries(records[0].attributes.map((a) => [a.key, a.value]));
    expect(attrs["budget_tokens"]).toEqual({ intValue: "40000" });
    expect(attrs["budget_exceeded"]).toEqual({ boolValue: false });
  });

  it("emits budget_exceeded WARN record when tokens exceed budget", () => {
    const report = makeReport();
    // tokens_claude = 5000, budget = 3000
    const records = buildLogRecords(report, { sessionId: "s2", budget: 3000 });
    expect(records).toHaveLength(2);
    expect(records[1].body.stringValue).toBe("mcp.tool_surface.budget_exceeded");
    expect(records[1].severityText).toBe("WARN");
    expect(records[1].severityNumber).toBe(13);
    const attrs = Object.fromEntries(records[1].attributes.map((a) => [a.key, a.value]));
    expect(attrs["tokens_claude"]).toEqual({ intValue: "5000" });
    expect(attrs["budget_tokens"]).toEqual({ intValue: "3000" });
    expect(attrs["over_by"]).toEqual({ intValue: "2000" });
    expect(attrs["claude.session_id"]).toEqual({ stringValue: "s2" });
  });

  it("emits overlap_detected WARN record when clusters exist", () => {
    const report = makeReport({
      overlapClusters: [
        {
          label: "search intent",
          score: 0.8,
          reason: "shared search intent",
          signals: ["intent-heuristic"],
          tools: [{ server: "a", name: "search" }],
          recommendation: "Prefer one search surface."
        }
      ]
    });
    const records = buildLogRecords(report, { sessionId: "s3" });
    expect(records).toHaveLength(2);
    expect(records[1].body.stringValue).toBe("mcp.tool_surface.overlap_detected");
    expect(records[1].severityText).toBe("WARN");
    const attrs = Object.fromEntries(records[1].attributes.map((a) => [a.key, a.value]));
    expect(attrs["clusters"]).toEqual({ intValue: "1" });
    expect(attrs["labels"]).toEqual({
      arrayValue: { values: [{ stringValue: "search intent" }] }
    });
    expect(attrs["claude.session_id"]).toEqual({ stringValue: "s3" });
  });

  it("emits all three records when budget exceeded and overlap exists", () => {
    const report = makeReport({
      overlapClusters: [
        {
          label: "issue creation",
          score: 0.9,
          reason: "shared create intent",
          signals: ["intent-heuristic"],
          tools: [{ server: "a", name: "create_issue" }],
          recommendation: "Use task-specific profiles."
        }
      ]
    });
    const records = buildLogRecords(report, { sessionId: "s4", budget: 3000 });
    expect(records).toHaveLength(3);
    expect(records[0].body.stringValue).toBe("mcp.tool_surface");
    expect(records[1].body.stringValue).toBe("mcp.tool_surface.budget_exceeded");
    expect(records[2].body.stringValue).toBe("mcp.tool_surface.overlap_detected");
  });

  it("omits claude.session_id attribute when sessionId is empty", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "" });
    const keys = records[0].attributes.map((a) => a.key);
    expect(keys).not.toContain("claude.session_id");
  });

  it("omits claude.session_id from budget_exceeded record when sessionId is empty", () => {
    const records = buildLogRecords(makeReport(), { sessionId: "", budget: 3000 });
    const warn = records.find((r) => r.body.stringValue === "mcp.tool_surface.budget_exceeded");
    expect(warn).toBeDefined();
    expect(warn!.attributes.map((a) => a.key)).not.toContain("claude.session_id");
  });

  it("omits claude.session_id from overlap_detected record when sessionId is empty", () => {
    const report = makeReport({
      overlapClusters: [
        {
          label: "search intent",
          score: 0.8,
          reason: "shared search intent",
          signals: ["intent-heuristic"],
          tools: [{ server: "a", name: "search" }],
          recommendation: "Prefer one search surface."
        }
      ]
    });
    const records = buildLogRecords(report, { sessionId: "" });
    const warn = records.find((r) => r.body.stringValue === "mcp.tool_surface.overlap_detected");
    expect(warn).toBeDefined();
    expect(warn!.attributes.map((a) => a.key)).not.toContain("claude.session_id");
  });
});
