import type { Confidence, InspectionMode, ReportTransportKind } from "../inspectors/types.js";

export type AnalyzedTool = {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  estimatedTokens: {
    claude: number;
    openaiCl100k: number;
  };
  hasInputSchema: boolean;
};

export type OverlapCluster = {
  label: string;
  score: number;
  reason: string;
  signals: Array<"tfidf" | "intent-heuristic">;
  tools: Array<{
    server: string;
    name: string;
    description?: string;
    estimatedTokens?: {
      claude?: number;
      openaiCl100k?: number;
    };
  }>;
  recommendation: string;
};

export type TareReport = {
  version: string;
  generatedAt: string;
  summary: {
    configFiles: number;
    servers: number;
    tools: number;
    estimatedTokens: {
      claude: number;
      openaiCl100k: number;
    };
    contextWindows: {
      "64000": {
        claude: number;
        openaiCl100k: number;
      };
      "128000": {
        claude: number;
        openaiCl100k: number;
      };
      "200000": {
        claude: number;
        openaiCl100k: number;
      };
    };
    insufficientServers: number;
  };
  servers: Array<{
    name: string;
    sourceConfigPath: string;
    transport: ReportTransportKind;
    command?: string;
    args?: string[];
    urlHost?: string;
    toolCount: number;
    estimatedTokens: {
      claude: number;
      openaiCl100k: number;
    };
    inspectionMode: InspectionMode;
    confidence: Confidence;
    warnings: string[];
    tools: Array<{
      name: string;
      description?: string;
      estimatedTokens: {
        claude: number;
        openaiCl100k: number;
      };
      hasInputSchema: boolean;
    }>;
  }>;
  overlapClusters: OverlapCluster[];
  recommendations: Array<{
    type: string;
    message: string;
  }>;
  warnings: string[];
  metadata: {
    staticOnly: boolean;
    inspectionMode: "live default" | "static-only" | "programmatic";
    budgetExceeded?: boolean;
    budgetTokens?: number;
    budgetTokenizer?: "claude" | "openai";
  };
};
