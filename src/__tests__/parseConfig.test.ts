import { describe, expect, it } from "vitest";
import { parseConfigText } from "../discovery/parseConfig.js";

describe("parseConfigText", () => {
  it("parses Claude-style mcpServers config", () => {
    const parsed = parseConfigText(
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" }
          }
        }
      }),
      "/tmp/config.json"
    );

    expect(parsed.servers[0]).toMatchObject({
      name: "github",
      command: "npx",
      transport: "stdio"
    });
  });

  it("parses alternate servers config shape", () => {
    const parsed = parseConfigText(
      JSON.stringify({
        servers: {
          filesystem: {
            command: "node",
            args: ["server.js"]
          }
        }
      }),
      "/tmp/config.json"
    );

    expect(parsed.servers[0]).toMatchObject({
      name: "filesystem",
      command: "node",
      transport: "stdio"
    });
  });

  it("parses nested mcp.servers config shape", () => {
    const parsed = parseConfigText(
      JSON.stringify({
        mcp: {
          servers: {
            linear: {
              command: "linear-mcp"
            }
          }
        }
      }),
      "/tmp/config.json"
    );

    expect(parsed.servers[0]).toMatchObject({
      name: "linear",
      command: "linear-mcp",
      transport: "stdio"
    });
  });

  it("parses hosted Streamable HTTP config with url", () => {
    const parsed = parseConfigText(
      JSON.stringify({
        mcpServers: {
          last9: {
            url: "https://mcp.last9.io/mcp",
            headers: {
              Authorization: "Bearer ${LAST9_MCP_TOKEN}"
            }
          }
        }
      }),
      "/tmp/config.json"
    );

    expect(parsed.servers[0]).toMatchObject({
      name: "last9",
      url: "https://mcp.last9.io/mcp",
      transport: "streamable-http"
    });
  });

  it('treats type: "http" URL configs as Streamable HTTP', () => {
    const parsed = parseConfigText(
      JSON.stringify({
        mcpServers: {
          last9: {
            type: "http",
            url: "https://app.last9.io/mcp"
          }
        }
      }),
      "/tmp/config.json"
    );

    expect(parsed.servers[0]).toMatchObject({
      name: "last9",
      url: "https://app.last9.io/mcp",
      transport: "streamable-http"
    });
  });

  it("produces warnings for malformed config instead of crashing", () => {
    const parsed = parseConfigText("{", "/tmp/bad.json");
    expect(parsed.servers).toEqual([]);
    expect(parsed.warnings[0]).toContain("malformed JSON");
  });
});
