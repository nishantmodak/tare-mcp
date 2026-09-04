import { VERSION } from "../version.js";
import type { OtlpLogRecord } from "./buildLogRecords.js";

export type OtlpExportOptions = {
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
  timeoutMs?: number;
};

export async function exportOtlpLogs(
  records: OtlpLogRecord[],
  options: OtlpExportOptions
): Promise<void> {
  const url = `${options.endpoint.replace(/\/$/, "")}/v1/logs`;
  const body = JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: options.serviceName } },
            { key: "tare.version", value: { stringValue: VERSION } }
          ]
        },
        scopeLogs: [
          {
            scope: { name: "tare-mcp", version: VERSION },
            logRecords: records
          }
        ]
      }
    ]
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      process.stderr.write(`tare-mcp hook: OTLP export failed (HTTP ${response.status})\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tare-mcp hook: OTLP export error: ${message}\n`);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseOtlpHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  return Object.fromEntries(
    raw.split(",").flatMap((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return [];
      return [[pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]];
    })
  );
}
