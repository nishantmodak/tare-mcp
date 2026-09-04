import { describe, expect, it } from "vitest";
import { OverlapDetector } from "../analysis/overlapDetector.js";
import type { AnalyzedTool } from "../analysis/types.js";

function tool(server: string, name: string, description: string): AnalyzedTool {
  return {
    server,
    name,
    description,
    inputSchema: { type: "object" },
    estimatedTokens: { claude: 100, openaiCl100k: 90 },
    hasInputSchema: true
  };
}

describe("OverlapDetector", () => {
  it("clusters similar tools", () => {
    const clusters = new OverlapDetector().detect([
      tool("a", "query_database", "Run a SQL query against a database table"),
      tool("b", "sql_query", "Query database tables with SQL"),
      tool("c", "send_email", "Send an email message")
    ]);

    expect(
      clusters.some((cluster) => cluster.tools.some((entry) => entry.name === "query_database"))
    ).toBe(true);
  });

  it("clusters github.create_issue and linear.create_issue", () => {
    const clusters = new OverlapDetector().detect([
      tool("github", "create_issue", "Create a GitHub issue"),
      tool("linear", "create_issue", "Create a Linear issue")
    ]);

    expect(clusters[0]?.label).toBe("issue creation");
    expect(clusters[0]?.recommendation).toBe(
      "Disable duplicate write paths unless explicitly needed."
    );
  });

  it("detects textual-only overlap when the corpus contains exactly two tools", () => {
    const clusters = new OverlapDetector().detect([
      tool("acme", "user_profile", "Read the user profile for the authenticated user."),
      tool("acme2", "user_profile", "Read the user profile for the authenticated user.")
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.tools.map((entry) => entry.server).sort()).toEqual(["acme", "acme2"]);
    expect(clusters[0]?.signals).toContain("tfidf");
  });

  it("clusters search_code and grep as search intent", () => {
    const clusters = new OverlapDetector().detect([
      tool("github", "search_code", "Search code in repositories"),
      tool("filesystem", "grep", "Find text in files"),
      tool("linear", "search_issues", "Search issues")
    ]);

    expect(clusters[0]?.label).toBe("search intent");
    expect(clusters[0]?.tools).toHaveLength(3);
  });

  it("does not cluster unrelated generic get tools", () => {
    const clusters = new OverlapDetector().detect([
      tool("weather", "get_forecast", "Get forecast for a location"),
      tool("github", "get_commit", "Get commit by sha"),
      tool("calendar", "get_event", "Get event by id")
    ]);

    expect(clusters).toEqual([]);
  });
});
