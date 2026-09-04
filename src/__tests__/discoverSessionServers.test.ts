import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverSessionServers,
  mergeSessionServers
} from "../discovery/discoverSessionServers.js";
import type { InspectedServer } from "../inspectors/types.js";
import { tempDir } from "./testUtils.js";

describe("discoverSessionServers", () => {
  it("returns no servers when the Claude session cache is absent", async () => {
    const home = await tempDir();
    try {
      await expect(discoverSessionServers(home.path)).resolves.toEqual({
        servers: [],
        sourceFile: null
      });
    } finally {
      await home.cleanup();
    }
  });

  it("normalizes and deduplicates cached hosted connectors", async () => {
    const home = await tempDir();
    try {
      const sessionDirectory = path.join(
        home.path,
        "Library",
        "Application Support",
        "Claude",
        "claude-code-sessions"
      );
      await mkdir(sessionDirectory, { recursive: true });
      const sessionFile = path.join(sessionDirectory, "session.json");
      await writeFile(
        sessionFile,
        JSON.stringify({
          remoteMcpServersConfig: [
            {
              uuid: "gmail-1",
              name: "gmail",
              tools: [
                {
                  name: "search_mail",
                  description: "Search mail",
                  inputSchema: { type: "object" }
                }
              ]
            },
            {
              uuid: "gmail-2",
              name: "gmail",
              tools: [{ name: "duplicate" }]
            }
          ]
        }),
        "utf8"
      );

      const result = await discoverSessionServers(home.path);

      expect(result.sourceFile).toBe(sessionFile);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        name: "gmail",
        sourceConfigPath: sessionFile,
        transport: "programmatic",
        inspectionMode: "programmatic",
        confidence: "high",
        toolDefinitions: [{ name: "search_mail", description: "Search mail" }]
      });
    } finally {
      await home.cleanup();
    }
  });

  it("keeps inspected config servers ahead of same-named cached connectors", () => {
    const configured = inspectedServer("github", "live");
    const cachedDuplicate = inspectedServer("github", "programmatic");
    const cachedConnector = inspectedServer("gmail", "programmatic");

    expect(mergeSessionServers([configured], [cachedDuplicate, cachedConnector])).toEqual([
      configured,
      cachedConnector
    ]);
  });
});

function inspectedServer(
  name: string,
  inspectionMode: InspectedServer["inspectionMode"]
): InspectedServer {
  return {
    name,
    sourceConfigPath: "test",
    transport: inspectionMode === "live" ? "stdio" : "programmatic",
    toolDefinitions: [],
    inspectionMode,
    confidence: "high",
    warnings: []
  };
}
