import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfigs, getDefaultConfigCandidates } from "../discovery/discoverConfigs.js";
import { tempDir } from "./testUtils.js";

describe("config discovery", () => {
  it("includes expected common locations", () => {
    const cwd = "/repo";
    const home = "/home/alice";
    expect(getDefaultConfigCandidates(cwd, home)).toEqual([
      "/repo/.mcp.json",
      "/repo/mcp.json",
      "/repo/.cursor/mcp.json",
      "/repo/.vscode/mcp.json",
      "/home/alice/.claude/mcp.json",
      "/home/alice/.claude/settings.json",
      "/home/alice/.claude/settings.local.json",
      "/home/alice/Library/Application Support/Claude/claude_desktop_config.json",
      "/home/alice/.config/Claude/claude_desktop_config.json",
      "/home/alice/.config/claude/claude_desktop_config.json",
      "/home/alice/.config/tare/mcp.json"
    ]);
  });

  it("discovers ~/.claude/mcp.json (Claude Code default location)", async () => {
    const home = await tempDir();
    try {
      const claudeDir = path.join(home.path, ".claude");
      await mkdir(claudeDir, { recursive: true });
      await writeFile(path.join(claudeDir, "mcp.json"), "{}");

      const result = await discoverConfigs(home.path, home.path);
      expect(result.paths).toContain(path.join(home.path, ".claude", "mcp.json"));
    } finally {
      await home.cleanup();
    }
  });

  it("discovers local and home config files", async () => {
    const cwd = await tempDir();
    const home = await tempDir();

    try {
      await writeFile(path.join(cwd.path, ".mcp.json"), "{}");
      const claudeDir = path.join(home.path, ".config", "claude");
      await mkdir(claudeDir, { recursive: true });
      await writeFile(path.join(claudeDir, "claude_desktop_config.json"), "{}");

      const result = await discoverConfigs(cwd.path, home.path);

      expect(result.paths).toContain(path.join(cwd.path, ".mcp.json"));
      expect(result.paths).toContain(
        path.join(home.path, ".config", "claude", "claude_desktop_config.json")
      );
    } finally {
      await cwd.cleanup();
      await home.cleanup();
    }
  });
});
