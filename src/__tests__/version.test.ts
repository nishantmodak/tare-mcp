import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VERSION } from "../version.js";

describe("package version", () => {
  it("keeps the runtime version aligned with package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8")
    ) as { version: string };

    expect(VERSION).toBe(packageJson.version);
  });
});
