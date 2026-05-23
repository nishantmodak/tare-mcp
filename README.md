# tare-mcp

See what your MCP tools weigh before your agent does anything.

```bash
npx tare-mcp
```

MCP made tools easy to connect.
It did not make them cheap to carry.

`tare-mcp` inspects your MCP setup and shows:

- how many tools your agent sees
- how much context those tools consume
- which servers dominate the budget
- which tools overlap and compete for model attention
- whether your setup exceeds a context budget

Think of it as:

```bash
du -sh node_modules
```

but for agent tool context.

## Table of Contents

- [Why This Matters](#why-this-matters)
- [Why Token Count Is Not the Whole Problem](#why-token-count-is-not-the-whole-problem)
- [Quickstart](#quickstart)
- [Hosted MCP Quickstart](#hosted-mcp-quickstart)
- [Scenario Examples](#scenario-examples)
- [Example Output](#example-output)
- [Supported Transports](#supported-transports)
- [Static vs Live Inspection](#static-vs-live-inspection)
- [Accuracy](#accuracy)
- [Security Model](#security-model)
- [Config Discovery](#config-discovery)
- [JSON Usage](#json-usage)
- [CI Usage](#ci-usage)
- [Publishing to npm](#publishing-to-npm)
- [CLI](#cli)
- [Roadmap](#roadmap)
- [License](#license)

## Why this matters

Every MCP tool is context the model has to carry before it can act. Large tool lists and verbose schemas reduce the room left for the actual task, and they can make routing decisions noisier.

`tare-mcp` makes that weight visible locally, before a coding agent or assistant spends any of its working context on it.

## Why token count is not the whole problem

A bloated MCP setup hurts in two ways.

First, it consumes context.

Second, it creates ambiguity.

If three servers all expose tools that look like "search", the model has to choose between them before it can do useful work.

`tare-mcp` shows both:

- what your tools weigh
- where your tools overlap

## Quickstart

After the package is published:

```bash
npx tare-mcp
```

On the first run you should see something like:

```txt
tare-mcp — MCP context weight

Config files found: 1
Servers analyzed: 2
Inspection mode: live default
Tools exposed: 47

Estimated context weight:
- Claude estimate:        ~18,400 tokens
- OpenAI cl100k estimate: ~17,800 tokens

Context window usage:
- 200k window:  9%
- 128k window: 14%
- 64k window:  29%
```

If the output is empty or shows "Config files found: 0", see [Config discovery](#config-discovery).

Install it in a project:

```bash
npm install --save-dev tare-mcp
npx tare-mcp
```

Install it globally:

```bash
npm install --global tare-mcp
tare-mcp
```

For local development from this repository:

```bash
pnpm install
pnpm build
pnpm dev
```

Static-only mode parses config without starting servers or calling hosted endpoints:

```bash
npx tare-mcp --no-exec
```

Set a budget:

```bash
npx tare-mcp --budget 40000
npx tare-mcp --budget 40000 --tokenizer openai
```

Emit JSON for CI or other tools:

```bash
npx tare-mcp --json
```

## Hosted MCP Quickstart

Use this when you want to inspect a real hosted MCP endpoint.

```bash
mkdir -p /tmp/tare-mcp-hosted
cd /tmp/tare-mcp-hosted
cp /path/to/tare-mcp/examples/scenarios/hosted-streamable-http.mcp.json .mcp.json
export LAST9_MCP_TOKEN="..."
npx tare-mcp --timeout 10000
```

The hosted example config points at Last9's observability MCP endpoint:

```txt
https://mcp.last9.io/mcp
```

To use a different hosted MCP server, edit the `url` and `headers` in `.mcp.json`. Any Streamable HTTP MCP server works here.

If the token is missing or invalid, `tare-mcp` reports a `401 Unauthorized` fallback instead of crashing.

Expected shape with valid credentials:

```txt
Inspecting last9 via streamable-http...

tare-mcp — MCP context weight

Config files found: 1
Servers analyzed: 1
Inspection mode: live default
Tools exposed: ...
```

## Scenario Examples

Scenario files live in [`examples/scenarios`](examples/scenarios):

- [`hosted-streamable-http.mcp.json`](examples/scenarios/hosted-streamable-http.mcp.json): hosted Streamable HTTP MCP with bearer-token auth.
- [`local-stdio.mcp.json`](examples/scenarios/local-stdio.mcp.json): packaged stdio MCP server.
- [`examples/scenarios/README.md`](examples/scenarios/README.md): copy-paste commands for each scenario.

For a no-credentials local Streamable HTTP smoke test, use [`examples/live-streamable-http`](examples/live-streamable-http):

```bash
pnpm install
pnpm build
cd examples/live-streamable-http
node server.mjs
```

Then in another terminal:

```bash
cd examples/live-streamable-http
mkdir -p .home
HOME="$PWD/.home" node ../../dist/cli.js
```

The temporary `HOME` keeps local smoke tests focused on the example `.mcp.json` instead of mixing in your real Claude or editor MCP configs.

Expected local smoke-test shape:

```txt
Inspecting tare-live-http-example via streamable-http...

tare-mcp — MCP context weight

Config files found: 1
Servers analyzed: 1
Inspection mode: live default
Tools exposed: 2

Worst servers:
1. tare-live-http-example ...

Worst tools:
1. tare-live-http-example.search_docs ...
2. tare-live-http-example.read_doc ...
```

## Example output

```txt
tare-mcp — MCP context weight

MCP made tools easy to connect. It did not make them cheap to carry.

Config files found: 2
Servers analyzed: 3
Inspection mode: live default
Tools exposed: 418

Estimated context weight:
- Claude estimate:        ~143,200 tokens
- OpenAI cl100k estimate: ~138,400 tokens

Context window usage:
- 200k window: 72%
- 128k window: 112%
- 64k window: 224%

Worst servers:
1. github       ~67,410 Claude tokens   188 tools
2. notion       ~41,800 Claude tokens    96 tools
3. linear       ~34,010 Claude tokens   134 tools

Worst tools:
1. github.create_pull_request      ~3,912 Claude tokens
2. notion.query_database           ~3,110 Claude tokens
3. linear.create_issue             ~2,440 Claude tokens

Overlap warnings: 3 clusters

1. search intent
   github.search_code
   filesystem.grep
   linear.search_issues
   → Prefer one search surface per workflow.

2. file write
   filesystem.write_file
   github.create_or_update_file
   → Disable duplicate write paths unless explicitly needed.

3. issue creation
   github.create_issue
   linear.create_issue
   jira.create_issue
   → Create task-specific profiles.

Recommendations:
- Split large MCP servers into task-specific profiles.
- Prefer read-only profiles for common workflows.
- Avoid exposing multiple tools for the same intent unless needed.
- Disable rarely used write/admin tools.
- Use `tare-mcp --budget 40000` to enforce a context budget.
- Use `tare-mcp --json` to track this in CI.
```

## Supported transports

v0.1 supports live inspection for:

- stdio MCP servers
- Streamable HTTP MCP servers

SSE may be supported best-effort later.

If a server cannot be inspected because credentials are missing, the endpoint is wrong, or the transport is unsupported, `tare-mcp` falls back to static-insufficient mode and says so clearly.

## Static vs live inspection

Live inspection is the default because it asks MCP servers for the tool definitions they actually expose through `tools/list`.

```bash
npx tare-mcp
```

Static-only mode does not spawn stdio MCP servers and does not call hosted MCP URLs:

```bash
npx tare-mcp --no-exec
```

Static-only mode is insufficient for packaged or hosted MCP servers because config files usually contain only commands, args, URLs, and headers. They do not contain the tool schemas the model receives.

## Accuracy

`tare-mcp` reports estimates, not exact truth.

Live inspection shows the actual tool definitions exposed by your MCP servers at inspection time.

Token counts are still model-dependent. `tare-mcp` shows both Claude and OpenAI cl100k estimates where possible.

By default, Claude token counts are local approximations. API-backed Claude token counting is optional and must be explicitly enabled:

```bash
npx tare-mcp --claude-tokenizer api
```

That mode requires `ANTHROPIC_API_KEY` and uses Anthropic's `POST /v1/messages/count_tokens` endpoint.

Environment variables that control tokenization:

| Variable | Values | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | string | — | Required for `--claude-tokenizer api` |
| `TARE_CLAUDE_TOKENIZER` | `local`, `api` | `local` | Override `--claude-tokenizer` via env |
| `TARE_ANTHROPIC_MODEL` | model ID | `claude-sonnet-4-6` | Model used for API-backed token counting |
| `TARE_DISABLE_ANTHROPIC_TOKEN_API` | `1` | unset | Disable API-backed counting even when requested |

## Security model

`tare-mcp` is local-first.

By default, it does not call cloud tokenization APIs.

Live inspection does execute configured stdio MCP server commands and calls configured hosted MCP URLs so it can ask them for their actual tool definitions.

Use `--no-exec` for static-only mode, but note that static-only mode is insufficient for packaged or hosted MCP servers because it cannot see exposed tool schemas.

`tare-mcp` redacts environment variable values and header values in logs, warnings, JSON, and errors.

## Config discovery

`tare-mcp` discovers MCP configs from common locations:

```txt
./.mcp.json
./mcp.json
./.cursor/mcp.json
./.vscode/mcp.json
~/.claude/mcp.json
~/Library/Application Support/Claude/claude_desktop_config.json
~/.config/Claude/claude_desktop_config.json
~/.config/claude/claude_desktop_config.json
~/.config/tare/mcp.json
```

Supported server maps:

```json
{
  "mcpServers": {}
}
```

```json
{
  "servers": {}
}
```

```json
{
  "mcp": {
    "servers": {}
  }
}
```

See [`examples/stdio.mcp.json`](examples/stdio.mcp.json) and [`examples/streamable-http.mcp.json`](examples/streamable-http.mcp.json).

## JSON usage

```bash
npx tare-mcp --json > tare-report.json
```

The JSON report includes:

- version and generation time
- summary counts
- per-server inspection mode and confidence
- both Claude and OpenAI cl100k estimates
- per-tool estimates
- overlap clusters
- recommendations
- warnings

Secrets from env vars and headers are redacted.

## CI usage

```yaml
name: MCP context budget

on:
  pull_request:

jobs:
  tare:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx tare-mcp --budget 40000
```

For CI systems that should not execute local MCP server commands, use static-only mode and treat the result as insufficient:

```bash
npx tare-mcp --no-exec --json
```

## Publishing to npm

This repository includes [`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml).

To publish from GitHub Actions:

1. Create an npm automation token.
2. Add it to the repository as `NPM_TOKEN`.
3. Publish a GitHub release or run the workflow manually.

The workflow runs:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run lint
pnpm build
npm pack --dry-run
npm publish --access public --provenance
```

The npm package is named `tare-mcp` because the unscoped `tare` package name is already occupied on npm.

Users can install it with:

```bash
npm install --save-dev tare-mcp
npx tare-mcp
```

For one-off usage:

```bash
npx tare-mcp
```

The installed binary is named `tare-mcp`, so global installs work as `tare-mcp`:

```bash
npm install --global tare-mcp
tare-mcp
```

## CLI

```txt
Usage: tare-mcp [options]

Analyze MCP context weight and tool ambiguity.

MCP made tools easy to connect. It did not make them cheap to carry.

Options:
  --no-exec                    Static-only mode. Does not spawn MCP servers or call hosted MCP URLs.
  --timeout <ms>               Live inspection timeout per server. Default: 5000.
  --budget <tokens>            Fail if estimated context weight exceeds budget.
  --tokenizer <name>           Budget tokenizer: claude or openai. Default: claude.
  --json                       Output JSON report.
  --claude-tokenizer <mode>    Claude tokenizer mode: local or api. Default: local.
  -h, --help                   Display help.
```

## Roadmap

v0.2 targets:
- [ ] Per-tool schema breakdown
- [ ] Context budget config file (`tare.config.json`)

Later:
- [ ] Better SSE fallback
- [ ] Improved Claude local token estimator
- [ ] Opt-in API-backed token counting improvements
- [ ] GitHub Actions integration
- [ ] HTML reports
- [ ] Compare mode
- [ ] MCP profile generator
- [ ] `tare-mcp --fix` to generate lean MCP profiles

Compare mode, dashboards, profile generation, and auto-fix are intentionally not part of v0.1.

## License

MIT
