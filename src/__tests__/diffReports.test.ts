import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TareDiffReport } from "../diff/diffTypes.js";
import { diffReports, overlapClusterIdentity } from "../diff/diffReports.js";
import { loadReport, ReportLoadError } from "../diff/loadReport.js";
import { evaluateDiffThresholds, hasThresholdFailure } from "../diff/thresholds.js";
import {
  renderDiffHumanReport,
  renderDiffThresholdFailure
} from "../reporters/diffHumanReporter.js";
import { renderDiffJsonReport } from "../reporters/diffJsonReporter.js";
import { baseReport, headReport } from "./fixtures/diffReportFixtures.js";
import { tempDir } from "./testUtils.js";

function buildDiff() {
  return diffReports(baseReport(), headReport(), {
    basePath: "base.json",
    headPath: "head.json",
    generatedAt: "2026-01-03T00:00:00.000Z"
  });
}

describe("diffReports", () => {
  it("computes added, removed, and changed MCP surfaces", () => {
    const diff = buildDiff();

    expect(diff.summary.servers).toEqual({ base: 2, head: 3, delta: 1 });
    expect(diff.summary.tools).toEqual({ base: 3, head: 6, delta: 3 });
    expect(diff.summary.estimatedTokens.delta).toEqual({ claude: 1800, openaiCl100k: 1620 });
    expect(diff.servers.added.map((server) => server.name)).toEqual(["notion", "slack"]);
    expect(diff.servers.removed.map((server) => server.name)).toEqual(["linear"]);
    expect(diff.servers.changed[0]).toMatchObject({
      name: "github",
      toolCount: { base: 2, head: 3, delta: 1 },
      estimatedTokens: { delta: { claude: 500, openaiCl100k: 450 } }
    });
    expect(diff.tools.added.map((tool) => `${tool.server}.${tool.name}`)).toContain(
      "github.create_issue"
    );
    expect(diff.tools.changed[0]).toMatchObject({
      server: "github",
      name: "search_code",
      descriptionChanged: true,
      estimatedTokens: { delta: { claude: 100, openaiCl100k: 90 } }
    });
    expect(diff.overlapClusters.added).toHaveLength(1);
    expect(diff.overlapClusters.removed).toHaveLength(1);
    expect(diff.warnings[0]).toContain("Base report version 0.1.0 differs");
  });

  it("uses sorted tool ids as overlap cluster identity", () => {
    const cluster = baseReport().overlapClusters[0];
    const reversed = {
      ...cluster,
      tools: [...cluster.tools].reverse()
    };

    expect(overlapClusterIdentity(reversed)).toBe(overlapClusterIdentity(cluster));
  });
});

describe("diff thresholds", () => {
  it("marks only positive increases above configured limits as failures", () => {
    const diff = buildDiff();
    diff.thresholds = evaluateDiffThresholds(diff, {
      maxTokenIncrease: 1000,
      maxToolIncrease: 3,
      maxServerIncrease: 1,
      maxOverlapIncrease: 0,
      tokenizer: "claude"
    });

    expect(diff.thresholds).toEqual([
      {
        flag: "--max-token-increase",
        tokenizer: "claude",
        allowed: 1000,
        actual: 1800,
        exceeded: true
      },
      { flag: "--max-tool-increase", allowed: 3, actual: 3, exceeded: false },
      { flag: "--max-server-increase", allowed: 1, actual: 1, exceeded: false },
      { flag: "--max-overlap-increase", allowed: 0, actual: 1, exceeded: true }
    ]);
    expect(Object.hasOwn(diff.thresholds[1] ?? {}, "tokenizer")).toBe(false);
    expect(hasThresholdFailure(diff)).toBe(true);
  });
});

describe("diff report loading", () => {
  it("loads a v0.1 tare-mcp JSON report", async () => {
    const dir = await tempDir();
    try {
      const filePath = path.join(dir.path, "base.json");
      await writeFile(filePath, JSON.stringify(baseReport()), "utf8");

      await expect(loadReport(filePath)).resolves.toMatchObject({
        path: filePath,
        report: { summary: { tools: 3 } }
      });
    } finally {
      await dir.cleanup();
    }
  });

  it("rejects JSON that is not a tare-mcp report", async () => {
    const dir = await tempDir();
    try {
      const filePath = path.join(dir.path, "bad.json");
      await writeFile(filePath, JSON.stringify({ not: "a tare report at all" }), "utf8");

      await expect(loadReport(filePath)).rejects.toThrow(ReportLoadError);
    } finally {
      await dir.cleanup();
    }
  });
});

describe("diff reporters", () => {
  it("renders human output with new and changed sections split clearly", () => {
    const output = renderDiffHumanReport(buildDiff(), { tokenizer: "claude" });

    expect(output).toContain("New servers:");
    expect(output).toContain("- notion: 2 tools");
    expect(output).toContain("Largest changes to existing servers:");
    expect(output).toContain("- github:");
  });

  it("uses the selected tokenizer in server and tool detail sections", () => {
    const output = renderDiffHumanReport(buildDiff(), { tokenizer: "openai" });

    expect(output).toContain("- notion: 2 tools, ~990 OpenAI cl100k tokens");
    expect(output).toContain("- github: 2 -> 3 (+1) tools, ~+450 OpenAI cl100k tokens");
    expect(output).toContain("- slack.search_messages: ~560 OpenAI cl100k tokens");
    expect(output).toContain("- github.search_code: ~+90 OpenAI cl100k tokens");
    expect(output).not.toContain("~1,100 Claude tokens");
  });

  it("renders token thresholds as approximate estimates only for token flags", () => {
    const diff = buildDiff();
    diff.thresholds = evaluateDiffThresholds(diff, {
      maxTokenIncrease: 1000,
      maxToolIncrease: 2,
      tokenizer: "claude"
    });

    const output = renderDiffHumanReport(diff, { tokenizer: "claude" });
    const failure = renderDiffThresholdFailure(diff, { tokenizer: "claude" });

    expect(output).toContain("--max-token-increase: fail (~1,800 / ~1,000 Claude tokens)");
    expect(output).toContain("--max-tool-increase: fail (3 / 2 tools)");
    expect(failure).toContain("--max-token-increase: allowed ~1,000, actual ~1,800 Claude tokens");
    expect(failure).toContain("--max-tool-increase: allowed 2, actual 3 tools");
  });

  it("renders threshold failure details with top offenders", () => {
    const diff = buildDiff();
    diff.thresholds = evaluateDiffThresholds(diff, {
      maxTokenIncrease: 1000,
      tokenizer: "claude"
    });

    const output = renderDiffThresholdFailure(diff, { tokenizer: "claude" });

    expect(output).toContain("FAILED: MCP context regression threshold exceeded.");
    expect(output).toContain("Top server increases:");
    expect(output).toContain("notion");
  });

  it("renders parseable JSON diff reports", () => {
    const parsed = JSON.parse(renderDiffJsonReport(buildDiff())) as TareDiffReport;

    expect(parsed.version).toBe("0.2.0");
  });
});
