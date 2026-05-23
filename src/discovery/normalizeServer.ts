import { z } from "zod";
import type { NormalizedServer, TransportKind } from "../inspectors/types.js";

const ServerConfigSchema = z.record(z.string(), z.unknown());

export type NormalizeResult = {
  server?: NormalizedServer;
  warnings: string[];
};

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length === value.length ? strings : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const strings = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return strings.length === entries.length ? Object.fromEntries(strings) : undefined;
}

function inferTransport(config: Record<string, unknown>): TransportKind {
  const explicit = String(config.transport ?? config.type ?? "").toLowerCase();

  if (explicit.includes("sse")) {
    return "sse";
  }

  if (typeof config.command === "string") {
    return "stdio";
  }

  if (typeof config.url === "string") {
    return "streamable-http";
  }

  return "unknown";
}

export function normalizeServer(
  name: string,
  rawConfig: unknown,
  sourceConfigPath: string
): NormalizeResult {
  const parsed = ServerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return {
      warnings: [`${sourceConfigPath}: server "${name}" is malformed and was skipped.`]
    };
  }

  const config = parsed.data;
  const warnings: string[] = [];

  const command = typeof config.command === "string" ? config.command : undefined;
  const url = typeof config.url === "string" ? config.url : undefined;
  const args = readStringArray(config.args);
  const env = readStringRecord(config.env);
  const headers = readStringRecord(config.headers);

  if (config.args !== undefined && !args) {
    warnings.push(
      `${sourceConfigPath}: server "${name}" has non-string args and they were ignored.`
    );
  }

  if (config.env !== undefined && !env) {
    warnings.push(
      `${sourceConfigPath}: server "${name}" has non-string env values and env was ignored.`
    );
  }

  if (config.headers !== undefined && !headers) {
    warnings.push(
      `${sourceConfigPath}: server "${name}" has non-string headers and headers were ignored.`
    );
  }

  if (!command && !url) {
    warnings.push(
      `${sourceConfigPath}: server "${name}" has no command or url; transport is unknown.`
    );
  }

  return {
    server: {
      name,
      command,
      args,
      env,
      url,
      headers,
      disabled: config.disabled === true,
      sourceConfigPath,
      transport: inferTransport(config)
    },
    warnings
  };
}
