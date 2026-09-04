import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import fg from "fast-glob";
import { expandHome } from "../utils/fs.js";

const LOCAL_CONFIG_PATTERNS = [".mcp.json", "mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"];

const HOME_CONFIG_PATTERNS = [
  "~/.claude.json",
  "~/.claude/mcp.json",
  "~/.claude/settings.json",
  "~/.claude/settings.local.json",
  "~/Library/Application Support/Claude/claude_desktop_config.json",
  "~/.config/Claude/claude_desktop_config.json",
  "~/.config/claude/claude_desktop_config.json",
  "~/.config/tare/mcp.json"
];

export function getDefaultConfigCandidates(cwd = process.cwd(), home = os.homedir()): string[] {
  return [
    ...LOCAL_CONFIG_PATTERNS.map((candidate) => path.resolve(cwd, candidate)),
    ...HOME_CONFIG_PATTERNS.map((candidate) => expandHome(candidate, home))
  ];
}

export type DiscoverConfigResult = {
  paths: string[];
  warnings: string[];
};

export async function discoverConfigs(
  cwd = process.cwd(),
  home = os.homedir()
): Promise<DiscoverConfigResult> {
  const warnings: string[] = [];
  const localMatches = await fg(LOCAL_CONFIG_PATTERNS, {
    cwd,
    absolute: true,
    onlyFiles: true,
    dot: true,
    unique: true
  });

  const homeCandidates = HOME_CONFIG_PATTERNS.map((candidate) => expandHome(candidate, home));
  const homeMatches: string[] = [];

  for (const candidate of homeCandidates) {
    if (await isFile(candidate)) {
      homeMatches.push(candidate);
    }
  }

  const paths = [...new Set([...localMatches, ...homeMatches])].sort();
  return { paths, warnings };
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
