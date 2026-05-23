import { Command } from "commander";
import { z } from "zod";
import { analyzeServers } from "./analysis/analyze.js";
import { discoverConfigs } from "./discovery/discoverConfigs.js";
import { parseConfigFile } from "./discovery/parseConfig.js";
import type { NormalizedServer, InspectedServer } from "./inspectors/types.js";
import { createStaticInspection } from "./inspectors/staticInspector.js";
import { inspectStdioServer } from "./inspectors/stdioMcpInspector.js";
import { inspectStreamableHttpServer } from "./inspectors/streamableHttpMcpInspector.js";
import {
  budgetActual,
  renderBudgetFailure,
  renderHumanReport,
  type BudgetTokenizer
} from "./reporters/humanReporter.js";
import { renderJsonReport } from "./reporters/jsonReporter.js";
import { TokenEstimator } from "./tokens/countTokens.js";
import type { ClaudeTokenizerMode } from "./tokens/types.js";
import { VERSION } from "./version.js";

const CliOptionsSchema = z.object({
  noExec: z.boolean().default(false),
  timeout: z.coerce.number().int().positive().default(5000),
  budget: z.coerce.number().int().positive().optional(),
  tokenizer: z.enum(["claude", "openai"]).default("claude"),
  json: z.boolean().default(false),
  claudeTokenizer: z.enum(["local", "api"]).default("local")
});

type CliOptions = z.infer<typeof CliOptionsSchema>;

function normalizeRawOptions(rawOptions: unknown): unknown {
  const raw =
    rawOptions && typeof rawOptions === "object" ? (rawOptions as Record<string, unknown>) : {};
  return {
    ...raw,
    noExec: raw.noExec ?? raw.exec === false
  };
}

function status(message: string): void {
  process.stderr.write(`${message}\n`);
}

function printInspectionWarning(server: string, inspected: InspectedServer): void {
  if (inspected.inspectionMode === "live" || inspected.warnings.length === 0) {
    return;
  }

  status(`⚠ ${server}: ${inspected.warnings[0]}`);
  for (const warning of inspected.warnings.slice(1, 4)) {
    status(`  ${warning}`);
  }
}

async function inspectServer(
  server: NormalizedServer,
  options: CliOptions
): Promise<InspectedServer> {
  if (options.noExec) {
    return createStaticInspection(server);
  }

  if (server.transport === "stdio") {
    status(`Inspecting ${server.name} via stdio...`);
    const inspected = await inspectStdioServer(server, { timeoutMs: options.timeout });
    printInspectionWarning(server.name, inspected);
    return inspected;
  }

  if (server.transport === "streamable-http" || server.transport === "http") {
    status(`Inspecting ${server.name} via streamable-http...`);
    const inspected = await inspectStreamableHttpServer(server, { timeoutMs: options.timeout });
    printInspectionWarning(server.name, inspected);
    return inspected;
  }

  const inspected = createStaticInspection(server, "fallback-static-insufficient", [
    `${server.transport ?? "unknown"} transport is unsupported in v0.1.`,
    "Static fallback cannot see actual tool definitions.",
    "Run again with a stdio or Streamable HTTP MCP server config."
  ]);
  printInspectionWarning(server.name, inspected);
  return inspected;
}

async function run(rawOptions: unknown): Promise<number> {
  const options = CliOptionsSchema.parse(normalizeRawOptions(rawOptions));
  const discovered = await discoverConfigs();
  const parsedConfigs = await Promise.all(
    discovered.paths.map((configPath) => parseConfigFile(configPath))
  );
  const parseWarnings = parsedConfigs.flatMap((config) => config.warnings);
  const servers = parsedConfigs
    .flatMap((config) => config.servers)
    .filter((server) => !server.disabled);

  const inspectedServers: InspectedServer[] = [];
  for (const server of servers) {
    inspectedServers.push(await inspectServer(server, options));
  }

  const tokenWarnings: string[] = [];
  const envClaudeTokenizer =
    process.env.TARE_CLAUDE_TOKENIZER === "api" || process.env.TARE_CLAUDE_TOKENIZER === "local"
      ? process.env.TARE_CLAUDE_TOKENIZER
      : undefined;
  const report = await analyzeServers(
    inspectedServers,
    new TokenEstimator({
      claudeTokenizerMode: (envClaudeTokenizer ?? options.claudeTokenizer) as ClaudeTokenizerMode,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicModel: process.env.TARE_ANTHROPIC_MODEL,
      anthropicDisabled: process.env.TARE_DISABLE_ANTHROPIC_TOKEN_API === "1",
      timeoutMs: options.timeout,
      onWarning: (warning) => tokenWarnings.push(warning)
    }),
    {
      configFiles: discovered.paths.length,
      staticOnly: options.noExec,
      warnings: [...discovered.warnings, ...parseWarnings]
    }
  );
  // Token warnings are emitted during analyzeServers while payloads are counted.
  // Append them after analysis so JSON/human reports include opt-in API fallback notices.
  report.warnings.push(...tokenWarnings);

  if (options.json) {
    process.stdout.write(renderJsonReport(report));
  } else {
    process.stdout.write(renderHumanReport(report));
    if (
      options.budget &&
      budgetActual(report, options.tokenizer as BudgetTokenizer) > options.budget
    ) {
      process.stdout.write(
        renderBudgetFailure(report, options.budget, options.tokenizer as BudgetTokenizer)
      );
    }
  }

  if (
    options.budget &&
    budgetActual(report, options.tokenizer as BudgetTokenizer) > options.budget
  ) {
    return 1;
  }

  return 0;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("tare")
    .description(
      [
        "Analyze MCP context weight and tool ambiguity.",
        "",
        "MCP made tools easy to connect. It did not make them cheap to carry."
      ].join("\n")
    )
    .version(VERSION)
    .option("--no-exec", "Static-only mode. Does not spawn MCP servers or call hosted MCP URLs.")
    .option("--timeout <ms>", "Live inspection timeout per server. Default: 5000.", "5000")
    .option("--budget <tokens>", "Fail if estimated context weight exceeds budget.")
    .option("--tokenizer <name>", "Budget tokenizer: claude or openai. Default: claude.", "claude")
    .option("--json", "Output JSON report.")
    .option(
      "--claude-tokenizer <mode>",
      "Claude tokenizer mode: local or api. Default: local.",
      "local"
    )
    .action(async (options: unknown) => {
      const exitCode = await run(options);
      process.exitCode = exitCode;
    });

  return program;
}

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
