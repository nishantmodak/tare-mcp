import { describe, expect, it, vi, afterEach } from "vitest";
import { exportOtlpLogs, parseOtlpHeaders } from "../hook/otlpLogExporter.js";
import type { OtlpLogRecord } from "../hook/buildLogRecords.js";

function makeRecord(): OtlpLogRecord {
  return {
    timeUnixNano: "1234567890000000000",
    severityNumber: 9,
    severityText: "INFO",
    body: { stringValue: "mcp.tool_surface" },
    attributes: [{ key: "tools", value: { intValue: "5" } }]
  };
}

describe("parseOtlpHeaders", () => {
  it("parses key=value pairs", () => {
    expect(parseOtlpHeaders("Authorization=Bearer tok")).toEqual({
      Authorization: "Bearer tok"
    });
  });

  it("parses multiple pairs", () => {
    expect(parseOtlpHeaders("Authorization=Bearer tok,X-Tenant=acme")).toEqual({
      Authorization: "Bearer tok",
      "X-Tenant": "acme"
    });
  });

  it("handles value containing equals sign", () => {
    expect(parseOtlpHeaders("Authorization=Basic dXNlcjpwYXNz")).toEqual({
      Authorization: "Basic dXNlcjpwYXNz"
    });
  });

  it("returns empty object for empty string", () => {
    expect(parseOtlpHeaders("")).toEqual({});
  });

  it("skips malformed pairs with no equals sign", () => {
    expect(parseOtlpHeaders("NoEquals,Authorization=Bearer tok")).toEqual({
      Authorization: "Bearer tok"
    });
  });
});

describe("exportOtlpLogs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to OTLP endpoint with /v1/logs appended", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    });

    await exportOtlpLogs([makeRecord()], {
      endpoint: "https://otlp.example.com",
      headers: { Authorization: "Bearer tok" },
      serviceName: "claude-code"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://otlp.example.com/v1/logs");
    expect((calls[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("strips trailing slash from endpoint before appending /v1/logs", async () => {
    const calls: { url: string }[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push({ url });
      return new Response("{}", { status: 200 });
    });

    await exportOtlpLogs([makeRecord()], {
      endpoint: "https://otlp.example.com/",
      headers: {},
      serviceName: "claude-code"
    });

    expect(calls[0].url).toBe("https://otlp.example.com/v1/logs");
  });

  it("includes resourceLogs envelope with service.name in body", async () => {
    let body = "";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = init.body as string;
      return new Response("{}", { status: 200 });
    });

    await exportOtlpLogs([makeRecord()], {
      endpoint: "https://otlp.example.com",
      headers: {},
      serviceName: "my-service"
    });

    const parsed = JSON.parse(body) as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeLogs: Array<{ logRecords: OtlpLogRecord[] }>;
      }>;
    };
    const serviceAttr = parsed.resourceLogs[0].resource.attributes.find(
      (a) => a.key === "service.name"
    );
    expect(serviceAttr?.value.stringValue).toBe("my-service");
    expect(parsed.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
  });

  it("writes warning to stderr on non-200 response and does not throw", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderrWrites.push(s as string);
      return true;
    });

    await expect(
      exportOtlpLogs([makeRecord()], {
        endpoint: "https://otlp.example.com",
        headers: {},
        serviceName: "claude-code"
      })
    ).resolves.toBeUndefined();

    expect(stderrWrites.some((s) => s.includes("401"))).toBe(true);
  });

  it("handles request timeout (AbortController fires) without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderrWrites.push(s as string);
      return true;
    });

    await expect(
      exportOtlpLogs([makeRecord()], {
        endpoint: "https://otlp.example.com",
        headers: {},
        serviceName: "claude-code",
        timeoutMs: 10
      })
    ).resolves.toBeUndefined();

    expect(stderrWrites.length).toBeGreaterThan(0);
  });

  it("writes warning to stderr on network error and does not throw", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderrWrites.push(s as string);
      return true;
    });

    await expect(
      exportOtlpLogs([makeRecord()], {
        endpoint: "https://otlp.example.com",
        headers: {},
        serviceName: "claude-code"
      })
    ).resolves.toBeUndefined();

    expect(stderrWrites.some((s) => s.includes("ECONNREFUSED"))).toBe(true);
  });

  it("handles non-Error thrown value without throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw "string-error";
    });
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderrWrites.push(s as string);
      return true;
    });

    await expect(
      exportOtlpLogs([makeRecord()], {
        endpoint: "https://otlp.example.com",
        headers: {},
        serviceName: "claude-code"
      })
    ).resolves.toBeUndefined();

    expect(stderrWrites.some((s) => s.includes("string-error"))).toBe(true);
  });
});
