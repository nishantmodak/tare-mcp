import { z } from "zod";
import type { TareReport } from "../analysis/types.js";
import { readUtf8 } from "../utils/fs.js";

const TokenTotalsSchema = z
  .object({
    claude: z.number(),
    openaiCl100k: z.number()
  })
  .passthrough();

const OptionalTokenTotalsSchema = z
  .object({
    claude: z.number().optional(),
    openaiCl100k: z.number().optional()
  })
  .passthrough();

const OverlapClusterSchema = z
  .object({
    label: z.string(),
    score: z.number(),
    reason: z.string(),
    signals: z.array(z.enum(["tfidf", "intent-heuristic"])),
    tools: z.array(
      z
        .object({
          server: z.string(),
          name: z.string(),
          description: z.string().optional(),
          estimatedTokens: OptionalTokenTotalsSchema.optional()
        })
        .passthrough()
    ),
    recommendation: z.string()
  })
  .passthrough();

export const TareReportSchema: z.ZodType<TareReport> = z
  .object({
    version: z.string(),
    generatedAt: z.string(),
    summary: z
      .object({
        configFiles: z.number(),
        servers: z.number(),
        tools: z.number(),
        estimatedTokens: TokenTotalsSchema,
        contextWindows: z
          .object({
            "64000": TokenTotalsSchema,
            "128000": TokenTotalsSchema,
            "200000": TokenTotalsSchema
          })
          .passthrough(),
        insufficientServers: z.number()
      })
      .passthrough(),
    servers: z.array(
      z
        .object({
          name: z.string(),
          sourceConfigPath: z.string(),
          transport: z.enum(["stdio", "streamable-http", "sse", "unknown"]),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          urlHost: z.string().optional(),
          toolCount: z.number(),
          estimatedTokens: TokenTotalsSchema,
          inspectionMode: z.enum(["live", "static-insufficient", "fallback-static-insufficient"]),
          confidence: z.enum(["high", "medium", "low"]),
          warnings: z.array(z.string()),
          tools: z.array(
            z
              .object({
                name: z.string(),
                description: z.string().optional(),
                estimatedTokens: TokenTotalsSchema,
                hasInputSchema: z.boolean()
              })
              .passthrough()
          )
        })
        .passthrough()
    ),
    overlapClusters: z.array(OverlapClusterSchema),
    recommendations: z.array(
      z
        .object({
          type: z.string(),
          message: z.string()
        })
        .passthrough()
    ),
    warnings: z.array(z.string()),
    metadata: z
      .object({
        staticOnly: z.boolean(),
        inspectionMode: z.enum(["live default", "static-only"])
      })
      .passthrough()
  })
  .passthrough();

export type LoadedTareReport = {
  path: string;
  report: TareReport;
};

export class ReportLoadError extends Error {
  readonly path: string;

  constructor(filePath: string, message: string) {
    super(message);
    this.name = "ReportLoadError";
    this.path = filePath;
  }
}

export async function loadReport(filePath: string): Promise<LoadedTareReport> {
  const text = await readReportText(filePath);
  const parsed = parseJson(filePath, text);
  const result = TareReportSchema.safeParse(parsed);

  if (!result.success) {
    throw new ReportLoadError(filePath, formatReportIssue(filePath, result.error.issues[0]));
  }

  return {
    path: filePath,
    report: result.data
  };
}

async function readReportText(filePath: string): Promise<string> {
  try {
    return await readUtf8(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ReportLoadError(filePath, `${filePath} was not found.`);
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new ReportLoadError(filePath, `Could not read ${filePath}: ${reason}`);
  }
}

function parseJson(filePath: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReportLoadError(filePath, `${filePath} is not valid JSON: ${reason}`);
  }
}

function formatReportIssue(filePath: string, issue: z.core.$ZodIssue | undefined): string {
  if (!issue) {
    return `${filePath} is not a valid tare-mcp report.`;
  }

  const field = issue.path.length > 0 ? issue.path.join(".") : "report";
  return `${filePath} has invalid ${field}: ${issue.message}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
