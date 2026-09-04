import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenEstimator } from "../tokens/countTokens.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("TokenEstimator", () => {
  it("produces dual token estimates", async () => {
    const estimates = await new TokenEstimator({ claudeTokenizerMode: "local" }).count(
      "hello world"
    );

    expect(estimates.claude.tokens).toBeGreaterThan(0);
    expect(estimates.claude.tokenizer).toBe("claude-estimate");
    expect(estimates.openaiCl100k.tokens).toBeGreaterThan(0);
    expect(estimates.openaiCl100k.tokenizer).toBe("openai-cl100k");
  });

  it("uses cl100k rather than the package-default o200k encoding", async () => {
    const estimates = await new TokenEstimator({ claudeTokenizerMode: "local" }).count(
      "こんにちは世界"
    );

    expect(estimates.openaiCl100k.tokens).toBe(4);
  });

  it("does not call Anthropic API by default", async () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    await new TokenEstimator({
      claudeTokenizerMode: "local",
      anthropicApiKey: "secret"
    }).count("hello world");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses Anthropic API only when explicitly requested", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ input_tokens: 123 })
    }));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const estimates = await new TokenEstimator({
      claudeTokenizerMode: "api",
      anthropicApiKey: "secret"
    }).count("hello world");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(estimates.claude).toMatchObject({
      tokenizer: "claude-api",
      tokens: 123,
      confidence: "high"
    });
  });

  it("falls back cleanly when API key is missing", async () => {
    const warnings: string[] = [];
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const estimates = await new TokenEstimator({
      claudeTokenizerMode: "api",
      onWarning: (warning) => warnings.push(warning)
    }).count("hello world");

    expect(fetch).not.toHaveBeenCalled();
    expect(estimates.claude.tokenizer).toBe("claude-estimate");
    expect(warnings.join("\n")).toContain("ANTHROPIC_API_KEY is not set");
  });

  it("honors TARE_DISABLE_ANTHROPIC_TOKEN_API behavior through option", async () => {
    const warnings: string[] = [];
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    await new TokenEstimator({
      claudeTokenizerMode: "api",
      anthropicApiKey: "secret",
      anthropicDisabled: true,
      onWarning: (warning) => warnings.push(warning)
    }).count("hello world");

    expect(fetch).not.toHaveBeenCalled();
    expect(warnings.join("\n")).toContain("TARE_DISABLE_ANTHROPIC_TOKEN_API=1");
  });

  it("recovers after a single transient Anthropic API failure", async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 503 } as Response;
      }
      return {
        ok: true,
        json: async () => ({ input_tokens: 999 })
      } as Response;
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const estimator = new TokenEstimator({
      claudeTokenizerMode: "api",
      anthropicApiKey: "secret"
    });

    const first = await estimator.count("first payload");
    const second = await estimator.count("second payload");
    const third = await estimator.count("third payload");

    expect(first.claude.tokenizer).toBe("claude-estimate");
    expect(second.claude).toMatchObject({ tokenizer: "claude-api", tokens: 999 });
    expect(third.claude).toMatchObject({ tokenizer: "claude-api", tokens: 999 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
