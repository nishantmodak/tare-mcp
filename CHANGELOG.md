# Changelog

All notable changes to `tare-mcp` are documented in this file.

## [0.4.0] - 2026-09-04

### Added

- Add the `tare-mcp hook` command for emitting Claude Code MCP tool-surface telemetry over OTLP/HTTP JSON.
- Discover cached Claude hosted connectors and Claude Code plugin MCP configurations.
- Include session identifiers, budget checks, and overlap events in hook telemetry.

### Fixed

- Prefer enabled MCP server definitions when duplicate names appear across configuration sources.
- Discover Claude Code user-scope configurations and ignore directory-shaped configuration paths.
- Limit stdio MCP server environments to configured variables instead of forwarding host secrets.
- Use the correct `cl100k` tokenizer and recover from transient Anthropic token API failures.
- Restore two-tool overlap detection and preserve write intent in overlap recommendations.
- Keep budget metadata, diff recommendations, and change ordering aligned with the selected tokenizer.
- Include cached hosted connectors in hook telemetry and encode OTLP `int64` values as decimal strings.
- Reject malformed and non-positive `TARE_HOOK_BUDGET` values.

[0.4.0]: https://github.com/nishantmodak/tare-mcp/compare/v0.3.0...v0.4.0
