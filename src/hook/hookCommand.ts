import { analyzeServers } from "../analysis/analyze.js";
import { discoverConfigs } from "../discovery/discoverConfigs.js";
import {
  discoverSessionServers,
  mergeSessionServers
} from "../discovery/discoverSessionServers.js";
import { parseConfigFile } from "../discovery/parseConfig.js";
import { createStaticInspection } from "../inspectors/staticInspector.js";
import { inspectStdioServer } from "../inspectors/stdioMcpInspector.js";
import { inspectStreamableHttpServer } from "../inspectors/streamableHttpMcpInspector.js";
import type { InspectedServer, NormalizedServer } from "../inspectors/types.js";
import { TokenEstimator } from "../tokens/countTokens.js";
import { buildLogRecords } from "./buildLogRecords.js";
import { exportOtlpLogs, parseOtlpHeaders } from "./otlpLogExporter.js";
import { readHookPayload } from "./readHookPayload.js";

export async function runHook(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    process.stderr.write("tare-mcp hook: OTEL_EXPORTER_OTLP_ENDPOINT is not set, skipping.\n");
    return;
  }

  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "");
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "claude-code";
  const budget = parseBudget(process.env.TARE_HOOK_BUDGET);

  try {
    const [payload, discovered, sessionResult] = await Promise.all([
      readHookPayload(),
      discoverConfigs(),
      discoverSessionServers()
    ]);

    const parsedConfigs = await Promise.all(discovered.paths.map((p) => parseConfigFile(p)));
    const servers = parsedConfigs.flatMap((c) => c.servers).filter((s) => !s.disabled);

    const inspectedServers: InspectedServer[] = [];
    for (const server of servers) {
      inspectedServers.push(await inspectServerForHook(server));
    }
    const allInspectedServers = mergeSessionServers(inspectedServers, sessionResult.servers);

    const report = await analyzeServers(
      allInspectedServers,
      new TokenEstimator({ claudeTokenizerMode: "local" }),
      { configFiles: discovered.paths.length, staticOnly: false }
    );

    const records = buildLogRecords(report, {
      sessionId: payload.sessionId,
      budget
    });

    await exportOtlpLogs(records, { endpoint, headers, serviceName });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tare-mcp hook: analysis failed: ${message}\n`);
  }
}

function parseBudget(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function inspectServerForHook(server: NormalizedServer): Promise<InspectedServer> {
  if (server.transport === "stdio") {
    return inspectStdioServer(server, { timeoutMs: 5000 });
  }
  if (server.transport === "streamable-http" || server.transport === "http") {
    return inspectStreamableHttpServer(server, { timeoutMs: 5000 });
  }
  return createStaticInspection(server, "fallback-static-insufficient", [
    `${server.transport ?? "unknown"} transport is unsupported.`
  ]);
}
