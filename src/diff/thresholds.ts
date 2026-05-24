import type { DiffThresholdOptions, TareDiffReport, ThresholdResult } from "./diffTypes.js";

export function evaluateDiffThresholds(
  report: TareDiffReport,
  options: DiffThresholdOptions
): ThresholdResult[] {
  const results: ThresholdResult[] = [];

  addThreshold(results, {
    flag: "--max-token-increase",
    tokenizer: options.tokenizer,
    allowed: options.maxTokenIncrease,
    actual:
      options.tokenizer === "openai"
        ? report.summary.estimatedTokens.delta.openaiCl100k
        : report.summary.estimatedTokens.delta.claude
  });

  addThreshold(results, {
    flag: "--max-tool-increase",
    allowed: options.maxToolIncrease,
    actual: report.summary.tools.delta
  });

  addThreshold(results, {
    flag: "--max-server-increase",
    allowed: options.maxServerIncrease,
    actual: report.summary.servers.delta
  });

  addThreshold(results, {
    flag: "--max-overlap-increase",
    allowed: options.maxOverlapIncrease,
    actual: report.overlapClusters.added.length
  });

  return results;
}

export function hasThresholdFailure(report: Pick<TareDiffReport, "thresholds">): boolean {
  return report.thresholds.some((threshold) => threshold.exceeded);
}

function addThreshold(
  results: ThresholdResult[],
  input: {
    flag: string;
    tokenizer?: ThresholdResult["tokenizer"];
    allowed?: number;
    actual: number;
  }
): void {
  if (input.allowed === undefined) {
    return;
  }

  const actualIncrease = Math.max(0, input.actual);
  const result: ThresholdResult = {
    flag: input.flag,
    allowed: input.allowed,
    actual: actualIncrease,
    exceeded: actualIncrease > input.allowed
  };
  if (input.tokenizer !== undefined) {
    result.tokenizer = input.tokenizer;
  }
  results.push(result);
}
