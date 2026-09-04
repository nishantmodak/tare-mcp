import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import type { TokenCounter, TokenEstimate } from "./types.js";

export class OpenAICl100kCounter implements TokenCounter {
  async count(text: string): Promise<TokenEstimate> {
    try {
      return {
        tokenizer: "openai-cl100k",
        tokens: encode(text).length,
        confidence: "high"
      };
    } catch {
      return {
        tokenizer: "fallback-char-ratio",
        tokens: Math.ceil(text.length / 4),
        confidence: "low",
        warning: "OpenAI cl100k tokenizer failed; using character-ratio fallback."
      };
    }
  }
}
