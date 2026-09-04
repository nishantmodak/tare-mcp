import type { Readable } from "node:stream";

type StopHookPayload = {
  session_id?: unknown;
};

export type HookPayload = {
  sessionId: string;
};

export async function readHookPayload(
  stdin: Readable = process.stdin as unknown as Readable
): Promise<HookPayload> {
  try {
    const raw = await drainStream(stdin);
    if (!raw.trim()) return { sessionId: "" };
    const parsed = JSON.parse(raw) as StopHookPayload;
    return {
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : ""
    };
  } catch {
    return { sessionId: "" };
  }
}

function drainStream(stream: Readable): Promise<string> {
  return new Promise((resolve) => {
    if ((stream as NodeJS.ReadStream).isTTY) {
      resolve("");
      return;
    }
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(""));
  });
}
