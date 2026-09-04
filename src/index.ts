export { VERSION } from "./version.js";

export type {
  Confidence,
  InspectionMode,
  InspectedServer,
  McpToolDefinition,
  NormalizedServer,
  ReportTransportKind,
  ToolContextPayload,
  TransportKind
} from "./inspectors/types.js";

export { discoverConfigs, getDefaultConfigCandidates } from "./discovery/discoverConfigs.js";
export { discoverSessionServers, mergeSessionServers } from "./discovery/discoverSessionServers.js";
export { parseConfigFile, parseConfigText } from "./discovery/parseConfig.js";
export { normalizeServer } from "./discovery/normalizeServer.js";
export { createStaticInspection } from "./inspectors/staticInspector.js";
export { inspectStdioServer, buildServerEnv } from "./inspectors/stdioMcpInspector.js";
export { inspectStreamableHttpServer } from "./inspectors/streamableHttpMcpInspector.js";
export { analyzeServers } from "./analysis/analyze.js";
export { measureTools } from "./api/measureTools.js";
export { OverlapDetector } from "./analysis/overlapDetector.js";
export { buildRecommendations } from "./analysis/recommendations.js";
export { TokenEstimator } from "./tokens/countTokens.js";
export { OpenAICl100kCounter } from "./tokens/openaiCl100kCounter.js";
export { LocalClaudeEstimator } from "./tokens/claudeEstimator.js";
export { renderHumanReport, renderBudgetFailure } from "./reporters/humanReporter.js";
export { renderJsonReport } from "./reporters/jsonReporter.js";
export { loadReport, TareReportSchema, ReportLoadError } from "./diff/loadReport.js";
export { diffReports, overlapClusterIdentity } from "./diff/diffReports.js";
export { evaluateDiffThresholds, hasThresholdFailure } from "./diff/thresholds.js";
export {
  renderDiffHumanReport,
  renderDiffThresholdFailure
} from "./reporters/diffHumanReporter.js";
export { renderDiffJsonReport } from "./reporters/diffJsonReporter.js";

export type { TareReport, OverlapCluster, AnalyzedTool } from "./analysis/types.js";
export type { AttributedMcpToolInput, McpToolInput, MeasureToolsOptions } from "./api/types.js";
export type { DiffReportsOptions } from "./diff/diffReports.js";
export type { DiffHumanReporterOptions } from "./reporters/diffHumanReporter.js";
export type {
  DiffOverlapCluster,
  DiffServer,
  DiffServerChange,
  DiffThresholdOptions,
  DiffTokenizer,
  DiffTokenTotals,
  DiffTool,
  DiffToolChange,
  NumericDelta,
  TareDiffReport,
  ThresholdResult,
  TokenDelta,
  ValueDelta
} from "./diff/diffTypes.js";
export type {
  ClaudeTokenizerMode,
  DualTokenEstimate,
  TokenCounter,
  TokenEstimate
} from "./tokens/types.js";
