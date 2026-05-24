import type { Confidence, InspectionMode, ReportTransportKind } from "../inspectors/types.js";

export type DiffTokenizer = "claude" | "openai";

export type DiffTokenTotals = {
  claude: number;
  openaiCl100k: number;
};

export type NumericDelta = {
  base: number;
  head: number;
  delta: number;
};

export type TokenDelta = {
  base: DiffTokenTotals;
  head: DiffTokenTotals;
  delta: DiffTokenTotals;
};

export type DiffServer = {
  name: string;
  sourceConfigPath: string;
  transport: ReportTransportKind;
  toolCount: number;
  estimatedTokens: DiffTokenTotals;
  inspectionMode: InspectionMode;
  confidence: Confidence;
};

export type DiffTool = {
  server: string;
  name: string;
  description?: string;
  estimatedTokens: DiffTokenTotals;
  hasInputSchema: boolean;
};

export type DiffServerChange = {
  name: string;
  toolCount: NumericDelta;
  estimatedTokens: TokenDelta;
  inspectionMode: {
    base: InspectionMode;
    head: InspectionMode;
    changed: boolean;
  };
  confidence: {
    base: Confidence;
    head: Confidence;
    changed: boolean;
  };
};

export type DiffToolChange = {
  server: string;
  name: string;
  estimatedTokens: TokenDelta;
  descriptionChanged: boolean;
  inputSchemaPresenceChanged: boolean;
};

export type DiffOverlapCluster = {
  id: string;
  label: string;
  score: number;
  tools: Array<{
    server: string;
    name: string;
  }>;
  recommendation: string;
};

export type ThresholdResult = {
  flag: string;
  tokenizer?: DiffTokenizer;
  allowed: number;
  actual: number;
  exceeded: boolean;
};

export type TareDiffReport = {
  version: string;
  generatedAt: string;
  base: {
    path: string;
    reportVersion: string;
    generatedAt: string;
  };
  head: {
    path: string;
    reportVersion: string;
    generatedAt: string;
  };
  summary: {
    servers: NumericDelta;
    tools: NumericDelta;
    estimatedTokens: TokenDelta;
    overlapClusters: NumericDelta;
  };
  servers: {
    added: DiffServer[];
    removed: DiffServer[];
    changed: DiffServerChange[];
  };
  tools: {
    added: DiffTool[];
    removed: DiffTool[];
    changed: DiffToolChange[];
  };
  overlapClusters: {
    added: DiffOverlapCluster[];
    removed: DiffOverlapCluster[];
  };
  thresholds: ThresholdResult[];
  recommendations: Array<{
    type: string;
    message: string;
  }>;
  warnings: string[];
};

export type DiffThresholdOptions = {
  maxTokenIncrease?: number;
  maxToolIncrease?: number;
  maxServerIncrease?: number;
  maxOverlapIncrease?: number;
  tokenizer: DiffTokenizer;
};
