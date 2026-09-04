import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { VERSION } from "../version.js";
import { collectSecretValues, isLikelyCredentialError, redactText } from "../utils/redact.js";
import { formatTimeout, TimeoutError, withTimeout } from "../utils/timeout.js";
import { createStaticInspection } from "./staticInspector.js";
import type {
  InspectorOptions,
  InspectedServer,
  McpToolDefinition,
  NormalizedServer
} from "./types.js";

export function buildServerEnv(server: NormalizedServer): Record<string, string> {
  return { ...(server.env ?? {}) };
}

type SdkTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  outputSchema?: unknown;
  _meta?: unknown;
  metadata?: unknown;
};

function normalizeTool(tool: SdkTool): McpToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    outputSchema: tool.outputSchema,
    metadata: tool.metadata ?? tool._meta
  };
}

async function listAllTools(client: Client): Promise<McpToolDefinition[]> {
  const tools: McpToolDefinition[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...result.tools.map(normalizeTool));
    cursor = result.nextCursor;
  } while (cursor);

  return tools;
}

function failureWarnings(
  server: NormalizedServer,
  error: unknown,
  timeoutMs: number,
  stderr: string,
  secrets: string[]
): string[] {
  const safeError = redactText(error, secrets);
  const safeStderr = redactText(stderr, secrets).trim();
  const combined = `${safeError}\n${safeStderr}`;

  if (error instanceof TimeoutError) {
    return [
      `live inspection failed after ${formatTimeout(timeoutMs)}.`,
      "Static config only sees command/args, not actual tool schemas.",
      "Token estimate for this server is insufficient."
    ];
  }

  if (isLikelyCredentialError(combined)) {
    const warnings = [
      "live inspection failed.",
      "The server may require credentials or failed during startup.",
      "Static config only sees command/args, not actual tool schemas.",
      "Token estimate for this server is insufficient."
    ];
    const detail = safeStderr || safeError;
    if (detail) {
      warnings.push(`Sanitized error: ${detail}`);
    }
    return warnings;
  }

  const detail = safeStderr || safeError;
  return [
    "live inspection failed.",
    "The server may require credentials or failed during startup.",
    "Static config only sees command/args, not actual tool schemas.",
    "Token estimate for this server is insufficient.",
    detail ? `Sanitized error: ${detail}` : `${server.name}: no error detail was available.`
  ];
}

export async function inspectStdioServer(
  server: NormalizedServer,
  options: InspectorOptions
): Promise<InspectedServer> {
  if (!server.command) {
    return createStaticInspection(server, "fallback-static-insufficient", [
      "live inspection failed.",
      "Stdio server config has no command.",
      "Static config only sees command/args, not actual tool schemas.",
      "Token estimate for this server is insufficient."
    ]);
  }

  const secrets = collectSecretValues(server.env);
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: buildServerEnv(server),
    stderr: "pipe"
  });
  const client = new Client({ name: "tare-mcp", version: VERSION }, { capabilities: {} });
  let stderr = "";

  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const close = async () => {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  };

  try {
    const tools = await withTimeout(
      (async () => {
        await client.connect(transport);
        return listAllTools(client);
      })(),
      options.timeoutMs,
      close
    );

    await close();

    return {
      name: server.name,
      sourceConfigPath: server.sourceConfigPath,
      transport: "stdio",
      command: server.command,
      args: server.args,
      toolDefinitions: tools,
      inspectionMode: "live",
      confidence: "high",
      warnings: []
    };
  } catch (error) {
    await close();
    return createStaticInspection(
      server,
      "fallback-static-insufficient",
      failureWarnings(server, error, options.timeoutMs, stderr, secrets)
    );
  }
}
