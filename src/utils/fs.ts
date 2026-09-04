import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(input: string, home = os.homedir()): string {
  if (input === "~") {
    return home;
  }

  if (input.startsWith("~/")) {
    return path.join(home, input.slice(2));
  }

  return input;
}

export async function readUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
