import os from "node:os";
import { stat } from "node:fs/promises";
import fg from "fast-glob";
import { z } from "zod";
import type { InspectedServer, McpToolDefinition } from "../inspectors/types.js";
import { readUtf8 } from "../utils/fs.js";

const SESSION_GLOB_PATTERNS = ["Library/Application Support/Claude/claude-code-sessions/**/*.json"];

const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  annotations: z.unknown().optional(),
  outputSchema: z.unknown().optional()
});

const RemoteMcpServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  tools: z.array(ToolSchema).default([])
});

const SessionFileSchema = z.object({
  remoteMcpServersConfig: z.array(RemoteMcpServerSchema).optional()
});

type SessionFile = z.infer<typeof SessionFileSchema>;

export function mergeSessionServers(
  inspectedServers: InspectedServer[],
  sessionServers: InspectedServer[]
): InspectedServer[] {
  const merged = [...inspectedServers];
  const seenNames = new Set(inspectedServers.map((server) => server.name));

  for (const sessionServer of sessionServers) {
    if (!seenNames.has(sessionServer.name)) {
      merged.push(sessionServer);
      seenNames.add(sessionServer.name);
    }
  }

  return merged;
}

async function readSessionFile(filePath: string): Promise<SessionFile | null> {
  try {
    const text = await readUtf8(filePath);
    const raw = JSON.parse(text);
    const parsed = SessionFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function getMtime(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export async function discoverSessionServers(
  home = os.homedir()
): Promise<{ servers: InspectedServer[]; sourceFile: string | null }> {
  const sessionFiles = await fg(SESSION_GLOB_PATTERNS, {
    cwd: home,
    absolute: true,
    onlyFiles: true,
    dot: true,
    unique: true
  });

  if (sessionFiles.length === 0) {
    return { servers: [], sourceFile: null };
  }

  // Use the most recently modified session file — it has the latest connector state.
  const withMtimes = await Promise.all(
    sessionFiles.map(async (f) => ({ path: f, mtime: await getMtime(f) }))
  );
  withMtimes.sort((a, b) => b.mtime - a.mtime);
  const mostRecent = withMtimes[0].path;

  const sessionData = await readSessionFile(mostRecent);
  if (!sessionData?.remoteMcpServersConfig?.length) {
    return { servers: [], sourceFile: mostRecent };
  }

  const seen = new Set<string>();
  const servers: InspectedServer[] = [];

  for (const entry of sessionData.remoteMcpServersConfig) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);

    const toolDefinitions: McpToolDefinition[] = entry.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      outputSchema: t.outputSchema
    }));

    servers.push({
      name: entry.name,
      sourceConfigPath: mostRecent,
      transport: "programmatic",
      toolDefinitions,
      inspectionMode: "programmatic",
      confidence: "high",
      warnings: []
    });
  }

  return { servers, sourceFile: mostRecent };
}
