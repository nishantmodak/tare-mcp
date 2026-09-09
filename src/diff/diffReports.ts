import type { TareReport } from "../analysis/types.js";
import type {
  DiffOverlapCluster,
  DiffServer,
  DiffServerChange,
  DiffTokenizer,
  DiffTokenTotals,
  DiffTool,
  DiffToolChange,
  NumericDelta,
  TareDiffReport,
  TokenDelta,
  ValueDelta
} from "./diffTypes.js";
import { VERSION } from "../version.js";

export type DiffReportsOptions = {
  basePath: string;
  headPath: string;
  generatedAt?: string;
  tokenizer?: DiffTokenizer;
};

type ReportServer = TareReport["servers"][number];
type ReportTool = ReportServer["tools"][number];
type ReportOverlapCluster = TareReport["overlapClusters"][number];

export function diffReports(
  baseReport: TareReport,
  headReport: TareReport,
  options: DiffReportsOptions
): TareDiffReport {
  const tokenizer = options.tokenizer ?? "claude";
  const baseServers = new Map(baseReport.servers.map((server) => [server.name, server]));
  const headServers = new Map(headReport.servers.map((server) => [server.name, server]));
  const baseTools = buildToolMap(baseReport);
  const headTools = buildToolMap(headReport);
  const baseClusters = buildClusterMap(baseReport);
  const headClusters = buildClusterMap(headReport);

  const report: TareDiffReport = {
    version: VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    base: {
      path: options.basePath,
      reportVersion: baseReport.version,
      generatedAt: baseReport.generatedAt
    },
    head: {
      path: options.headPath,
      reportVersion: headReport.version,
      generatedAt: headReport.generatedAt
    },
    summary: {
      servers: numericDelta(baseReport.summary.servers, headReport.summary.servers),
      tools: numericDelta(baseReport.summary.tools, headReport.summary.tools),
      estimatedTokens: tokenDelta(
        baseReport.summary.estimatedTokens,
        headReport.summary.estimatedTokens
      ),
      overlapClusters: numericDelta(
        baseReport.overlapClusters.length,
        headReport.overlapClusters.length
      )
    },
    servers: diffServers(baseServers, headServers, tokenizer),
    tools: diffTools(baseTools, headTools, tokenizer),
    overlapClusters: diffOverlapClusters(baseClusters, headClusters),
    thresholds: [],
    recommendations: [],
    warnings: buildWarnings(baseReport, headReport)
  };

  report.recommendations = buildDiffRecommendations(report, tokenizer);
  return report;
}

export function overlapClusterIdentity(cluster: ReportOverlapCluster): string {
  return JSON.stringify(cluster.tools.map((tool) => `${tool.server}.${tool.name}`).sort());
}

function diffServers(
  baseServers: Map<string, ReportServer>,
  headServers: Map<string, ReportServer>,
  tokenizer: DiffTokenizer
): TareDiffReport["servers"] {
  const added: DiffServer[] = [];
  const removed: DiffServer[] = [];
  const changed: DiffServerChange[] = [];

  for (const [name, headServer] of headServers) {
    const baseServer = baseServers.get(name);

    if (!baseServer) {
      added.push(toDiffServer(headServer));
      continue;
    }

    const serverChange = diffExistingServer(baseServer, headServer);
    if (isServerChanged(serverChange)) {
      changed.push(serverChange);
    }
  }

  for (const [name, baseServer] of baseServers) {
    if (!headServers.has(name)) {
      removed.push(toDiffServer(baseServer));
    }
  }

  return {
    added: added.sort((a, b) => compareServersByTokens(a, b, tokenizer)),
    removed: removed.sort((a, b) => compareServersByTokens(a, b, tokenizer)),
    changed: changed.sort((a, b) => compareServerChanges(a, b, tokenizer))
  };
}

function diffTools(
  baseTools: Map<string, DiffTool>,
  headTools: Map<string, DiffTool>,
  tokenizer: DiffTokenizer
): TareDiffReport["tools"] {
  const added: DiffTool[] = [];
  const removed: DiffTool[] = [];
  const changed: DiffToolChange[] = [];

  for (const [id, headTool] of headTools) {
    const baseTool = baseTools.get(id);

    if (!baseTool) {
      added.push(headTool);
      continue;
    }

    const toolChange = diffExistingTool(baseTool, headTool);
    if (isToolChanged(toolChange)) {
      changed.push(toolChange);
    }
  }

  for (const [id, baseTool] of baseTools) {
    if (!headTools.has(id)) {
      removed.push(baseTool);
    }
  }

  return {
    added: added.sort((a, b) => compareToolsByTokens(a, b, tokenizer)),
    removed: removed.sort((a, b) => compareToolsByTokens(a, b, tokenizer)),
    changed: changed.sort((a, b) => compareToolChanges(a, b, tokenizer))
  };
}

function diffOverlapClusters(
  baseClusters: Map<string, DiffOverlapCluster>,
  headClusters: Map<string, DiffOverlapCluster>
): TareDiffReport["overlapClusters"] {
  const added: DiffOverlapCluster[] = [];
  const removed: DiffOverlapCluster[] = [];

  for (const [id, headCluster] of headClusters) {
    if (!baseClusters.has(id)) {
      added.push(headCluster);
    }
  }

  for (const [id, baseCluster] of baseClusters) {
    if (!headClusters.has(id)) {
      removed.push(baseCluster);
    }
  }

  return {
    added: added.sort(compareClusters),
    removed: removed.sort(compareClusters)
  };
}

function diffExistingServer(base: ReportServer, head: ReportServer): DiffServerChange {
  return {
    name: head.name,
    toolCount: numericDelta(base.toolCount, head.toolCount),
    estimatedTokens: tokenDelta(base.estimatedTokens, head.estimatedTokens),
    transport: valueDelta(base.transport, head.transport),
    sourceConfigPath: valueDelta(base.sourceConfigPath, head.sourceConfigPath),
    command: valueDelta(base.command ?? null, head.command ?? null),
    args: valueDelta(base.args ?? null, head.args ?? null),
    urlHost: valueDelta(base.urlHost ?? null, head.urlHost ?? null),
    inspectionMode: valueDelta(base.inspectionMode, head.inspectionMode),
    confidence: valueDelta(base.confidence, head.confidence)
  };
}

function diffExistingTool(base: DiffTool, head: DiffTool): DiffToolChange {
  return {
    server: head.server,
    name: head.name,
    estimatedTokens: tokenDelta(base.estimatedTokens, head.estimatedTokens),
    descriptionChanged: (base.description ?? null) !== (head.description ?? null),
    inputSchemaPresenceChanged: base.hasInputSchema !== head.hasInputSchema
  };
}

function isServerChanged(change: DiffServerChange): boolean {
  return (
    change.toolCount.delta !== 0 ||
    change.estimatedTokens.delta.claude !== 0 ||
    change.estimatedTokens.delta.openaiCl100k !== 0 ||
    change.transport.changed ||
    change.sourceConfigPath.changed ||
    change.command.changed ||
    change.args.changed ||
    change.urlHost.changed ||
    change.inspectionMode.changed ||
    change.confidence.changed
  );
}

function isToolChanged(change: DiffToolChange): boolean {
  return (
    change.estimatedTokens.delta.claude !== 0 ||
    change.estimatedTokens.delta.openaiCl100k !== 0 ||
    change.descriptionChanged ||
    change.inputSchemaPresenceChanged
  );
}

function toDiffServer(server: ReportServer): DiffServer {
  return {
    name: server.name,
    sourceConfigPath: server.sourceConfigPath,
    transport: server.transport,
    command: server.command,
    args: server.args,
    urlHost: server.urlHost,
    toolCount: server.toolCount,
    estimatedTokens: server.estimatedTokens,
    inspectionMode: server.inspectionMode,
    confidence: server.confidence
  };
}

function toDiffTool(server: ReportServer, tool: ReportTool): DiffTool {
  return {
    server: server.name,
    name: tool.name,
    description: tool.description,
    estimatedTokens: tool.estimatedTokens,
    hasInputSchema: tool.hasInputSchema
  };
}

function toDiffOverlapCluster(cluster: ReportOverlapCluster): DiffOverlapCluster {
  return {
    id: overlapClusterIdentity(cluster),
    label: cluster.label,
    score: cluster.score,
    tools: cluster.tools.map((tool) => ({ server: tool.server, name: tool.name })),
    recommendation: cluster.recommendation
  };
}

function buildToolMap(report: TareReport): Map<string, DiffTool> {
  const tools = new Map<string, DiffTool>();

  for (const server of report.servers) {
    for (const tool of server.tools) {
      tools.set(toolKey(server.name, tool.name), toDiffTool(server, tool));
    }
  }

  return tools;
}

function buildClusterMap(report: TareReport): Map<string, DiffOverlapCluster> {
  const clusters = new Map<string, DiffOverlapCluster>();

  for (const cluster of report.overlapClusters) {
    clusters.set(overlapClusterIdentity(cluster), toDiffOverlapCluster(cluster));
  }

  return clusters;
}

function buildWarnings(baseReport: TareReport, headReport: TareReport): string[] {
  const warnings: string[] = [];

  if (baseReport.version !== headReport.version) {
    warnings.push(
      `Base report version ${baseReport.version} differs from head report version ${headReport.version}.`
    );
  }

  if (baseReport.metadata.staticOnly || headReport.metadata.staticOnly) {
    warnings.push(
      "One or both reports were generated with --no-exec; live tool/schema regressions may be hidden."
    );
  }

  return warnings;
}

export function buildDiffRecommendations(
  report: TareDiffReport,
  tokenizer: DiffTokenizer
): TareDiffReport["recommendations"] {
  const recommendations: TareDiffReport["recommendations"] = [];

  const tokenIncrease =
    tokenizer === "openai"
      ? report.summary.estimatedTokens.delta.openaiCl100k
      : report.summary.estimatedTokens.delta.claude;
  if (positiveIncrease(tokenIncrease) > 0) {
    recommendations.push({
      type: "budget",
      message: "Review the largest token increases before merging this MCP config change."
    });
  }

  if (report.servers.added.length > 0 || report.tools.added.length > 0) {
    recommendations.push({
      type: "profile",
      message: "Keep new MCP surfaces scoped to the workflows that actually need them."
    });
  }

  if (report.overlapClusters.added.length > 0) {
    recommendations.push({
      type: "overlap",
      message:
        "Resolve new overlapping tool clusters or document why both tools should stay exposed."
    });
  }

  if (recommendations.length === 0) {
    recommendations.push(
      report.thresholds.some((threshold) => threshold.exceeded)
        ? {
            type: "threshold",
            message:
              "Review the failed regression thresholds before merging this MCP config change."
          }
        : {
            type: "status",
            message: "No MCP context regression was detected in this diff."
          }
    );
  }

  return recommendations;
}

function tokenDelta(base: DiffTokenTotals, head: DiffTokenTotals): TokenDelta {
  return {
    base,
    head,
    delta: {
      claude: head.claude - base.claude,
      openaiCl100k: head.openaiCl100k - base.openaiCl100k
    }
  };
}

function numericDelta(base: number, head: number): NumericDelta {
  return {
    base,
    head,
    delta: head - base
  };
}

function valueDelta<T>(base: T, head: T): ValueDelta<T> {
  return {
    base,
    head,
    changed: JSON.stringify(base) !== JSON.stringify(head)
  };
}

function toolKey(server: string, tool: string): string {
  return `${server}\0${tool}`;
}

function tokenValue(tokens: DiffTokenTotals, tokenizer: DiffTokenizer): number {
  return tokenizer === "openai" ? tokens.openaiCl100k : tokens.claude;
}

function positiveIncrease(value: number): number {
  return Math.max(0, value);
}

function compareServersByTokens(a: DiffServer, b: DiffServer, tokenizer: DiffTokenizer): number {
  return (
    tokenValue(b.estimatedTokens, tokenizer) - tokenValue(a.estimatedTokens, tokenizer) ||
    a.name.localeCompare(b.name)
  );
}

function compareServerChanges(
  a: DiffServerChange,
  b: DiffServerChange,
  tokenizer: DiffTokenizer
): number {
  return (
    Math.abs(tokenValue(b.estimatedTokens.delta, tokenizer)) -
      Math.abs(tokenValue(a.estimatedTokens.delta, tokenizer)) || a.name.localeCompare(b.name)
  );
}

function compareToolsByTokens(a: DiffTool, b: DiffTool, tokenizer: DiffTokenizer): number {
  return (
    tokenValue(b.estimatedTokens, tokenizer) - tokenValue(a.estimatedTokens, tokenizer) ||
    `${a.server}.${a.name}`.localeCompare(`${b.server}.${b.name}`)
  );
}

function compareToolChanges(
  a: DiffToolChange,
  b: DiffToolChange,
  tokenizer: DiffTokenizer
): number {
  return (
    Math.abs(tokenValue(b.estimatedTokens.delta, tokenizer)) -
      Math.abs(tokenValue(a.estimatedTokens.delta, tokenizer)) ||
    `${a.server}.${a.name}`.localeCompare(`${b.server}.${b.name}`)
  );
}

function compareClusters(a: DiffOverlapCluster, b: DiffOverlapCluster): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}
