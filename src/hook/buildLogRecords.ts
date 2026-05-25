import type { TareReport } from "../analysis/types.js";

type OtlpStringValue = { stringValue: string };
type OtlpIntValue = { intValue: number };
type OtlpBoolValue = { boolValue: boolean };
type OtlpArrayValue = { arrayValue: { values: OtlpAnyValue[] } };
type OtlpAnyValue = OtlpStringValue | OtlpIntValue | OtlpBoolValue | OtlpArrayValue;

export type OtlpAttribute = { key: string; value: OtlpAnyValue };

export type OtlpLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: "INFO" | "WARN";
  body: OtlpStringValue;
  attributes: OtlpAttribute[];
};

export type BuildLogRecordsOptions = {
  sessionId: string;
  budget?: number;
};

export function buildLogRecords(
  report: TareReport,
  options: BuildLogRecordsOptions
): OtlpLogRecord[] {
  const timeUnixNano = String(BigInt(Date.now()) * BigInt(1_000_000));
  const { sessionId, budget } = options;
  const tokensClaude = report.summary.estimatedTokens.claude;
  const budgetExceeded = budget !== undefined && tokensClaude > budget;

  const mainAttrs: OtlpAttribute[] = [
    attr("servers", { intValue: report.summary.servers }),
    attr("tools", { intValue: report.summary.tools }),
    attr("tokens_claude", { intValue: tokensClaude }),
    attr("tokens_openai_cl100k", { intValue: report.summary.estimatedTokens.openaiCl100k }),
    attr("overlap_clusters", { intValue: report.overlapClusters.length }),
    attr("budget_exceeded", { boolValue: budgetExceeded })
  ];
  if (budget !== undefined) {
    mainAttrs.push(attr("budget_tokens", { intValue: budget }));
  }
  if (sessionId) {
    mainAttrs.push(attr("claude.session_id", { stringValue: sessionId }));
  }

  const records: OtlpLogRecord[] = [
    {
      timeUnixNano,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "mcp.tool_surface" },
      attributes: mainAttrs
    }
  ];

  if (budgetExceeded) {
    const warnAttrs: OtlpAttribute[] = [
      attr("tokens_claude", { intValue: tokensClaude }),
      attr("budget_tokens", { intValue: budget }),
      attr("over_by", { intValue: tokensClaude - budget })
    ];
    if (sessionId) warnAttrs.push(attr("claude.session_id", { stringValue: sessionId }));
    records.push({
      timeUnixNano,
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: "mcp.tool_surface.budget_exceeded" },
      attributes: warnAttrs
    });
  }

  if (report.overlapClusters.length > 0) {
    const overlapAttrs: OtlpAttribute[] = [
      attr("clusters", { intValue: report.overlapClusters.length }),
      attr("labels", {
        arrayValue: {
          values: report.overlapClusters.map((c) => ({ stringValue: c.label }))
        }
      })
    ];
    if (sessionId) overlapAttrs.push(attr("claude.session_id", { stringValue: sessionId }));
    records.push({
      timeUnixNano,
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: "mcp.tool_surface.overlap_detected" },
      attributes: overlapAttrs
    });
  }

  return records;
}

function attr(key: string, value: OtlpAnyValue): OtlpAttribute {
  return { key, value };
}
