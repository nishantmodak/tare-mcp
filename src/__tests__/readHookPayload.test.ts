import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readHookPayload } from "../hook/readHookPayload.js";

describe("readHookPayload", () => {
  it("extracts session_id from valid Claude Code Stop payload", async () => {
    const stream = Readable.from(['{"session_id":"abc-123","stop_hook_active":true}']);
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("abc-123");
  });

  it("returns empty sessionId when stdin is empty", async () => {
    const stream = Readable.from([""]);
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("");
  });

  it("returns empty sessionId when JSON has no session_id", async () => {
    const stream = Readable.from(['{"stop_hook_active":true}']);
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("");
  });

  it("returns empty sessionId when stdin is malformed JSON", async () => {
    const stream = Readable.from(["not-json"]);
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("");
  });

  it("returns empty sessionId when session_id is not a string", async () => {
    const stream = Readable.from(['{"session_id":42}']);
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("");
  });

  it("returns empty sessionId when stdin is a TTY (isTTY branch)", async () => {
    const stream = Readable.from(["should-not-be-read"]);
    (stream as unknown as { isTTY: boolean }).isTTY = true;
    const result = await readHookPayload(stream);
    expect(result.sessionId).toBe("");
  });

  it("returns empty sessionId when stream emits an error", async () => {
    const stream = new Readable({ read() {} });
    const promise = readHookPayload(stream);
    stream.destroy(new Error("stream error"));
    const result = await promise;
    expect(result.sessionId).toBe("");
  });
});
