import pc from "picocolors";
import type {
  DiffServer,
  DiffServerChange,
  DiffTokenizer,
  DiffTool,
  DiffToolChange,
  TareDiffReport
} from "../diff/diffTypes.js";

export type DiffHumanReporterOptions = {
  tokenizer: DiffTokenizer;
};

type TokenOffender = {
  label: string;
  tokens: number;
  details: string;
};

export function renderDiffHumanReport(
  report: TareDiffReport,
  options: DiffHumanReporterOptions
): string {
  const lines: string[] = [];

  lines.push(pc.bold("tare-mcp diff - MCP context regression"));
  lines.push("");
  lines.push(`Base: ${report.base.path} (${report.base.reportVersion})`);
  lines.push(`Head: ${report.head.path} (${report.head.reportVersion})`);
  lines.push("");

  for (const warning of report.warnings) {
    lines.push(pc.yellow(`Warning: ${warning}`));
  }

  if (report.warnings.length > 0) {
    lines.push("");
  }

  lines.push("Summary:");
  lines.push(`- Servers: ${formatDeltaLine(report.summary.servers)}`);
  lines.push(`- Tools: ${formatDeltaLine(report.summary.tools)}`);
  lines.push(`- Claude tokens: ${formatTokenDeltaLine(report.summary.estimatedTokens, "claude")}`);
  lines.push(
    `- OpenAI cl100k tokens: ${formatTokenDeltaLine(report.summary.estimatedTokens, "openai")}`
  );
  lines.push(`- Overlap clusters: ${formatDeltaLine(report.summary.overlapClusters)}`);

  pushServerSection(lines, "New servers", report.servers.added, options.tokenizer);
  pushServerSection(lines, "Removed servers", report.servers.removed, options.tokenizer);
  pushServerChangeSection(lines, report.servers.changed, options.tokenizer);
  pushToolSection(lines, "New tools", report.tools.added, options.tokenizer);
  pushToolSection(lines, "Removed tools", report.tools.removed, options.tokenizer);
  pushToolChangeSection(lines, report.tools.changed, options.tokenizer);
  pushOverlapSection(lines, report);
  pushThresholdSection(lines, report, options.tokenizer);
  pushRecommendations(lines, report);

  return `${lines.join("\n")}\n`;
}

export function renderDiffThresholdFailure(
  report: TareDiffReport,
  options: DiffHumanReporterOptions
): string {
  const failures = report.thresholds.filter((threshold) => threshold.exceeded);
  if (failures.length === 0) {
    return "";
  }

  const lines: string[] = [];

  lines.push("");
  lines.push(pc.red(pc.bold("FAILED: MCP context regression threshold exceeded.")));
  lines.push("");

  for (const failure of failures) {
    const label = thresholdLabel(failure.flag, failure.tokenizer ?? options.tokenizer);
    const isToken = failure.flag === "--max-token-increase";
    const fmt = isToken ? approx : formatNumber;
    lines.push(
      `${failure.flag}: allowed ${fmt(failure.allowed)}, actual ${fmt(failure.actual)} ${label}`
    );
  }

  const serverOffenders = tokenServerOffenders(report, options.tokenizer);
  if (serverOffenders.length > 0) {
    lines.push("");
    lines.push("Top server increases:");
    for (const [index, offender] of serverOffenders.slice(0, 5).entries()) {
      lines.push(
        `${index + 1}. ${padRight(offender.label, 20)} ${approxSigned(offender.tokens)} tokens (${offender.details})`
      );
    }
  }

  const toolOffenders = tokenToolOffenders(report, options.tokenizer);
  if (toolOffenders.length > 0) {
    lines.push("");
    lines.push("Top tool increases:");
    for (const [index, offender] of toolOffenders.slice(0, 5).entries()) {
      lines.push(
        `${index + 1}. ${padRight(offender.label, 34)} ${approxSigned(offender.tokens)} tokens (${offender.details})`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function pushServerSection(
  lines: string[],
  title: string,
  servers: DiffServer[],
  tokenizer: DiffTokenizer
): void {
  if (servers.length === 0) {
    return;
  }

  lines.push("");
  lines.push(`${title}:`);
  const tokenizerLabel = tokenizer === "openai" ? "OpenAI cl100k" : "Claude";
  for (const server of servers.slice(0, 10)) {
    lines.push(
      `- ${server.name}: ${server.toolCount} tools, ${approx(tokenValue(server.estimatedTokens, tokenizer))} ${tokenizerLabel} tokens`
    );
  }
}

function pushServerChangeSection(
  lines: string[],
  servers: DiffServerChange[],
  tokenizer: DiffTokenizer
): void {
  const materialChanges = servers.filter(
    (server) =>
      server.toolCount.delta !== 0 || tokenValue(server.estimatedTokens.delta, tokenizer) !== 0
  );

  if (materialChanges.length === 0) {
    return;
  }

  const tokenizerLabel = tokenizer === "openai" ? "OpenAI cl100k" : "Claude";
  lines.push("");
  lines.push("Largest changes to existing servers:");
  for (const server of materialChanges.slice(0, 10)) {
    lines.push(
      `- ${server.name}: ${formatDeltaLine(server.toolCount)} tools, ${approxSigned(
        tokenValue(server.estimatedTokens.delta, tokenizer)
      )} ${tokenizerLabel} tokens`
    );
  }
}

function pushToolSection(
  lines: string[],
  title: string,
  tools: DiffTool[],
  tokenizer: DiffTokenizer
): void {
  if (tools.length === 0) {
    return;
  }

  lines.push("");
  lines.push(`${title}:`);
  const tokenizerLabel = tokenizer === "openai" ? "OpenAI cl100k" : "Claude";
  for (const tool of tools.slice(0, 10)) {
    lines.push(
      `- ${tool.server}.${tool.name}: ${approx(tokenValue(tool.estimatedTokens, tokenizer))} ${tokenizerLabel} tokens`
    );
  }
}

function pushToolChangeSection(
  lines: string[],
  tools: DiffToolChange[],
  tokenizer: DiffTokenizer
): void {
  const materialChanges = tools.filter(
    (tool) => tokenValue(tool.estimatedTokens.delta, tokenizer) !== 0 || tool.descriptionChanged
  );

  if (materialChanges.length === 0) {
    return;
  }

  const tokenizerLabel = tokenizer === "openai" ? "OpenAI cl100k" : "Claude";
  lines.push("");
  lines.push("Largest changes to existing tools:");
  for (const tool of materialChanges.slice(0, 10)) {
    const notes = [
      tool.descriptionChanged ? "description changed" : undefined,
      tool.inputSchemaPresenceChanged ? "schema presence changed" : undefined
    ].filter(Boolean);
    const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
    lines.push(
      `- ${tool.server}.${tool.name}: ${approxSigned(
        tokenValue(tool.estimatedTokens.delta, tokenizer)
      )} ${tokenizerLabel} tokens${suffix}`
    );
  }
}

function pushOverlapSection(lines: string[], report: TareDiffReport): void {
  if (report.overlapClusters.added.length === 0 && report.overlapClusters.removed.length === 0) {
    return;
  }

  if (report.overlapClusters.added.length > 0) {
    lines.push("");
    lines.push("New overlap clusters:");
    for (const cluster of report.overlapClusters.added.slice(0, 5)) {
      lines.push(`- ${cluster.label}`);
      for (const tool of cluster.tools) {
        lines.push(`  ${tool.server}.${tool.name}`);
      }
    }
  }

  if (report.overlapClusters.removed.length > 0) {
    lines.push("");
    lines.push("Resolved overlap clusters:");
    for (const cluster of report.overlapClusters.removed.slice(0, 5)) {
      lines.push(`- ${cluster.label}`);
    }
  }
}

function pushThresholdSection(
  lines: string[],
  report: TareDiffReport,
  tokenizer: DiffTokenizer
): void {
  if (report.thresholds.length === 0) {
    return;
  }

  lines.push("");
  lines.push("Thresholds:");
  for (const threshold of report.thresholds) {
    const status = threshold.exceeded ? pc.red("fail") : pc.green("pass");
    const label = thresholdLabel(threshold.flag, threshold.tokenizer ?? tokenizer);
    const isToken = threshold.flag === "--max-token-increase";
    const fmt = isToken ? approx : formatNumber;
    lines.push(
      `- ${threshold.flag}: ${status} (${fmt(threshold.actual)} / ${fmt(threshold.allowed)} ${label})`
    );
  }
}

function pushRecommendations(lines: string[], report: TareDiffReport): void {
  if (report.recommendations.length === 0) {
    return;
  }

  lines.push("");
  lines.push("Recommendations:");
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation.message}`);
  }
}

function tokenServerOffenders(report: TareDiffReport, tokenizer: DiffTokenizer): TokenOffender[] {
  const added = report.servers.added.map((server) => ({
    label: server.name,
    tokens: tokenValue(server.estimatedTokens, tokenizer),
    details: `new server, ${server.toolCount} tools`
  }));
  const changed = report.servers.changed
    .map((server) => ({
      label: server.name,
      tokens: tokenValue(server.estimatedTokens.delta, tokenizer),
      details: `${formatSignedNumber(server.toolCount.delta)} tools`
    }))
    .filter((offender) => offender.tokens > 0);

  return [...added, ...changed].sort(compareOffenders);
}

function tokenToolOffenders(report: TareDiffReport, tokenizer: DiffTokenizer): TokenOffender[] {
  const added = report.tools.added.map((tool) => ({
    label: `${tool.server}.${tool.name}`,
    tokens: tokenValue(tool.estimatedTokens, tokenizer),
    details: "new tool"
  }));
  const changed = report.tools.changed
    .map((tool) => ({
      label: `${tool.server}.${tool.name}`,
      tokens: tokenValue(tool.estimatedTokens.delta, tokenizer),
      details: tool.descriptionChanged ? "description changed" : "existing tool"
    }))
    .filter((offender) => offender.tokens > 0);

  return [...added, ...changed].sort(compareOffenders);
}

function compareOffenders(a: TokenOffender, b: TokenOffender): number {
  return b.tokens - a.tokens || a.label.localeCompare(b.label);
}

function formatDeltaLine(delta: { base: number; head: number; delta: number }): string {
  return `${formatNumber(delta.base)} -> ${formatNumber(delta.head)} (${formatSignedNumber(
    delta.delta
  )})`;
}

function formatTokenDeltaLine(
  delta: {
    base: { claude: number; openaiCl100k: number };
    head: { claude: number; openaiCl100k: number };
    delta: { claude: number; openaiCl100k: number };
  },
  tokenizer: DiffTokenizer
): string {
  return `${approx(tokenValue(delta.base, tokenizer))} -> ${approx(
    tokenValue(delta.head, tokenizer)
  )} (${approxSigned(tokenValue(delta.delta, tokenizer))})`;
}

function tokenValue(
  tokens: { claude: number; openaiCl100k: number },
  tokenizer: DiffTokenizer
): number {
  return tokenizer === "openai" ? tokens.openaiCl100k : tokens.claude;
}

function thresholdLabel(flag: string, tokenizer: DiffTokenizer): string {
  if (flag === "--max-token-increase") {
    return tokenizer === "openai" ? "OpenAI cl100k tokens" : "Claude tokens";
  }

  if (flag === "--max-server-increase") {
    return "servers";
  }

  if (flag === "--max-overlap-increase") {
    return "new overlap clusters";
  }

  return "tools";
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatSignedNumber(value: number): string {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }

  return formatNumber(value);
}

function approx(value: number): string {
  return `~${formatNumber(value)}`;
}

function approxSigned(value: number): string {
  if (value > 0) {
    return `~+${formatNumber(value)}`;
  }

  if (value < 0) {
    return `~-${formatNumber(Math.abs(value))}`;
  }

  return "~0";
}

function padRight(text: string, length: number): string {
  return text.padEnd(length, " ");
}
