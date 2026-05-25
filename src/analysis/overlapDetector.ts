import type { AnalyzedTool, OverlapCluster } from "./types.js";

class TfIdf {
  private docs: string[][] = [];

  addDocument(tokens: string[], _id?: number): void {
    this.docs.push(tokens);
  }

  listTerms(index: number): Array<{ term: string; tfidf: number }> {
    const doc = this.docs[index] ?? [];
    const n = this.docs.length;

    const tf = new Map<string, number>();
    for (const term of doc) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }

    const df = new Map<string, number>();
    for (const d of this.docs) {
      for (const term of new Set(d)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }

    const result: Array<{ term: string; tfidf: number }> = [];
    for (const [term, count] of tf) {
      const termTf = count / doc.length;
      const idf = Math.log(n / (df.get(term) ?? 1));
      result.push({ term, tfidf: termTf * idf });
    }
    return result.sort((a, b) => b.tfidf - a.tfidf);
  }
}

type Signal = "tfidf" | "intent-heuristic";

type Edge = {
  from: number;
  to: number;
  score: number;
  signals: Set<Signal>;
  reason: string;
  label: string;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

const INTENT_BUCKETS = {
  search: ["search", "find", "query", "grep", "lookup", "list"],
  read: ["get", "read", "fetch", "retrieve", "show"],
  write: ["write", "create", "update", "edit", "patch", "delete", "remove"],
  file: ["file", "path", "directory", "filesystem", "fs"],
  issue: ["issue", "ticket", "task", "bug"],
  repo: ["repo", "repository", "code", "commit", "pull", "pr", "branch"],
  incident: ["incident", "alert", "page", "pager", "oncall"],
  database: ["sql", "query", "table", "database", "db"]
} as const;

const VERB_BUCKETS = ["search", "read", "write"] as const;
const NOUN_BUCKETS = ["file", "issue", "repo", "incident", "database"] as const;

type VerbBucket = (typeof VERB_BUCKETS)[number];
type NounBucket = (typeof NOUN_BUCKETS)[number];

function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function toolDocument(tool: AnalyzedTool): string {
  return [
    `${tool.server}.${tool.name}`,
    tool.description ?? "",
    JSON.stringify(tool.inputSchema ?? {})
  ].join("\n");
}

function tokensForTool(tool: AnalyzedTool): string[] {
  return splitWords(toolDocument(tool));
}

function buckets(tokens: string[]): {
  verbs: Set<VerbBucket>;
  nouns: Set<NounBucket>;
} {
  const tokenSet = new Set(tokens);
  const verbs = new Set<VerbBucket>();
  const nouns = new Set<NounBucket>();

  for (const verb of VERB_BUCKETS) {
    if (INTENT_BUCKETS[verb].some((word) => tokenSet.has(word))) {
      verbs.add(verb);
    }
  }

  for (const noun of NOUN_BUCKETS) {
    if (INTENT_BUCKETS[noun].some((word) => tokenSet.has(word))) {
      nouns.add(noun);
    }
  }

  return { verbs, nouns };
}

function vectorFromTerms(terms: Array<{ term: string; tfidf: number }>): Map<string, number> {
  return new Map(terms.map((term) => [term.term, term.tfidf]));
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of a.values()) {
    aNorm += value * value;
  }

  for (const value of b.values()) {
    bNorm += value * value;
  }

  for (const [term, value] of a) {
    dot += value * (b.get(term) ?? 0);
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function intersection<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((value) => b.has(value));
}

function labelFor(verb?: VerbBucket, noun?: NounBucket): string {
  if (verb === "search") {
    return "search intent";
  }

  if (verb === "write" && noun === "issue") {
    return "issue creation";
  }

  if (verb === "write" && noun === "file") {
    return "file write";
  }

  if (verb && noun) {
    return `${noun} ${verb}`;
  }

  return "similar tools";
}

function recommendationFor(label: string, verb?: VerbBucket): string {
  if (label === "search intent") {
    return "Prefer one search surface per workflow.";
  }

  if (verb === "write") {
    return "Disable duplicate write paths unless explicitly needed.";
  }

  return "Create task-specific profiles.";
}

function intentEdge(
  left: AnalyzedTool,
  right: AnalyzedTool,
  leftBuckets: ReturnType<typeof buckets>,
  rightBuckets: ReturnType<typeof buckets>
): Pick<Edge, "score" | "signals" | "reason" | "label"> | undefined {
  const sharedVerbs = intersection(leftBuckets.verbs, rightBuckets.verbs);
  const sharedNouns = intersection(leftBuckets.nouns, rightBuckets.nouns);

  if (sharedVerbs.includes("search")) {
    return {
      score: 0.75,
      signals: new Set(["intent-heuristic"]),
      reason: "tools share a search intent",
      label: "search intent"
    };
  }

  const strongVerb = sharedVerbs.find((verb) => verb === "write") ?? sharedVerbs[0];
  const noun = sharedNouns[0];

  if (strongVerb && noun) {
    return {
      score: 0.7,
      signals: new Set(["intent-heuristic"]),
      reason: `tools share ${strongVerb} and ${noun} intent buckets`,
      label: labelFor(strongVerb, noun)
    };
  }

  return undefined;
}

function mergeLabels(edges: Edge[]): string {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.label, (counts.get(edge.label) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "similar tools";
}

function components(size: number, edges: Edge[]): number[][] {
  const adjacency = new Map<number, Set<number>>();

  for (const edge of edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set());
    }
    if (!adjacency.has(edge.to)) {
      adjacency.set(edge.to, new Set());
    }
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<number>();
  const found: number[][] = [];

  for (let index = 0; index < size; index += 1) {
    if (visited.has(index) || !adjacency.has(index)) {
      continue;
    }

    const stack = [index];
    const component: number[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }

      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    if (component.length > 1) {
      found.push(component);
    }
  }

  return found;
}

export class OverlapDetector {
  constructor(private readonly threshold = 0.42) {}

  detect(tools: AnalyzedTool[]): OverlapCluster[] {
    if (tools.length < 2) {
      return [];
    }

    const tokenized = tools.map(tokensForTool);
    const bucketed = tokenized.map(buckets);
    const tfidf = new TfIdf();
    for (const [index, tokens] of tokenized.entries()) {
      tfidf.addDocument(tokens, index);
    }

    const vectors = tools.map((_tool, index) => vectorFromTerms(tfidf.listTerms(index)));
    const edges: Edge[] = [];

    for (let left = 0; left < tools.length; left += 1) {
      for (let right = left + 1; right < tools.length; right += 1) {
        if (tools[left]?.server === tools[right]?.server) {
          continue;
        }

        const similarity = cosineSimilarity(
          vectors[left] ?? new Map(),
          vectors[right] ?? new Map()
        );
        const heuristic = intentEdge(
          tools[left] as AnalyzedTool,
          tools[right] as AnalyzedTool,
          bucketed[left] as ReturnType<typeof buckets>,
          bucketed[right] as ReturnType<typeof buckets>
        );

        if (similarity >= this.threshold || heuristic) {
          const signals = new Set<Signal>(heuristic?.signals);
          if (similarity >= this.threshold) {
            signals.add("tfidf");
          }

          edges.push({
            from: left,
            to: right,
            score: Math.max(similarity, heuristic?.score ?? 0),
            signals,
            reason:
              heuristic?.reason ??
              `tool definitions have TF-IDF cosine similarity ${similarity.toFixed(2)}`,
            label: heuristic?.label ?? "similar tools"
          });
        }
      }
    }

    return components(tools.length, edges)
      .map((component) => {
        const componentEdges = edges.filter(
          (edge) => component.includes(edge.from) && component.includes(edge.to)
        );
        const signals = new Set<Signal>();
        for (const edge of componentEdges) {
          for (const signal of edge.signals) {
            signals.add(signal);
          }
        }

        const label = mergeLabels(componentEdges);
        const maxScore = Math.max(...componentEdges.map((edge) => edge.score));
        const reason = componentEdges[0]?.reason ?? "tools appear similar";
        const verb = componentEdges.some((edge) => edge.label.includes("write"))
          ? "write"
          : undefined;

        return {
          label,
          score: Number(maxScore.toFixed(2)),
          reason,
          signals: [...signals],
          tools: component
            .map((index) => tools[index] as AnalyzedTool)
            .sort((a, b) => `${a.server}.${a.name}`.localeCompare(`${b.server}.${b.name}`))
            .map((tool) => ({
              server: tool.server,
              name: tool.name,
              description: tool.description,
              estimatedTokens: {
                claude: tool.estimatedTokens.claude,
                openaiCl100k: tool.estimatedTokens.openaiCl100k
              }
            })),
          recommendation: recommendationFor(label, verb)
        } satisfies OverlapCluster;
      })
      .filter((cluster) => new Set(cluster.tools.map((tool) => tool.server)).size > 1)
      .sort((a, b) => b.score - a.score || b.tools.length - a.tools.length)
      .slice(0, 10);
  }
}
