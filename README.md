# mcp-entrascopes

A small, read-only [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for querying published Microsoft Entra first-party application scope metadata.

It is inspired by [EntraScopes](https://entrascopes.com/) and exposes the underlying scope information in a bounded, agent-friendly form.

It is designed for questions such as:

- Which Microsoft first-party applications publish `Application.Read.All` for Microsoft Graph?
- What scopes are associated with a known application (client) ID?
- Is an application marked as a public client or a member of a family of client IDs (FOCI)?

> [!IMPORTANT]
> Results are **not tenant state**. They do not prove that an application exists in a tenant, that an administrator granted consent, or that a token can obtain a listed scope. Verify tenant-specific grants separately with appropriately authorized Microsoft Graph queries.

## Why an MCP server instead of a skill?

The primary dataset is several megabytes and changes over time. A skill would either embed a stale snapshot or spend model context searching raw JSON. This server keeps retrieval and indexing outside the model, returns bounded structured results, caches upstream data, and exposes its provenance with every answer.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_entra_applications` | Search by application name/ID, scope, resource name/ID, FOCI status, or public-client status. |
| `get_entra_application` | Return published scope metadata for one exact application ID. |
| `get_entrascopes_data_status` | Report source URLs, fetch time, cache state, and record counts; optionally refresh. |

Search responses are capped at 50 applications. Exact scope matching is the default; use `scope_match: "contains"` only when discovery is intended.

## Requirements

- Node.js 20 or later
- Network access to GitHub raw content when the cache is empty or refreshed
- No Microsoft identity, Graph permission, secret, or tenant access

## Install and run

### From a clone

```powershell
git clone https://github.com/nathanmcnulty/mcp-entrascopes.git E:\mcp-entrascopes
Set-Location E:\mcp-entrascopes
npm ci
npm run build
codex mcp add entrascopes -- node E:\mcp-entrascopes\dist\index.js
```

Restart the Codex client after adding the server. The Codex desktop app, CLI, and IDE extension share the same host MCP configuration.

### Directly from GitHub with npm

```powershell
codex mcp add entrascopes -- npx -y github:nathanmcnulty/mcp-entrascopes
```

The package is prepared for npm publication but is not claimed to be published in the npm registry.

Other MCP clients can launch `node dist/index.js` over stdio.

## Data and caching

The server lazily downloads:

1. [`firstpartyscopes.json`](https://github.com/dirkjanm/ROADtools/blob/master/roadtx/roadtools/roadtx/firstpartyscopes.json) from ROADtools as the required scope dataset.
2. [`resources.json`](https://github.com/f-bader/entrascopes.com/blob/main/resources.json) from EntraScopes for optional resource display-name enrichment.

EntraScopes periodically copies the ROADtools scope file into its website repository. This server reads the MIT-licensed ROADtools source directly, while retaining EntraScopes resource-name enrichment and attribution.

The default cache lifetime is 60 minutes. If a refresh fails and an older cache exists, the server returns the stale cache and marks the result `cache-stale`. The cache is stored under `%LOCALAPPDATA%\mcp-entrascopes` on Windows or `~/.cache/mcp-entrascopes` elsewhere.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `ENTRASCOPES_CACHE_TTL_MINUTES` | `60` | Cache freshness interval; `0` refreshes on each request. |
| `ENTRASCOPES_CACHE_DIR` | OS cache directory | Override the cache directory. |
| `ENTRASCOPES_SCOPES_URL` | ROADtools raw URL | Override the required scope dataset URL. |
| `ENTRASCOPES_RESOURCES_URL` | EntraScopes raw URL | Override the optional resource-name dataset URL. |

Dataset URLs are process configuration only; MCP tool callers cannot supply arbitrary URLs.

## Provenance and licensing

This repository contains server code only and does not redistribute either dataset. ROADtools is MIT-licensed. The EntraScopes repository did not declare a repository license when this project was created, so its data is fetched from the publisher at runtime and remains subject to the upstream project's terms. The Unlicense in this repository applies only to this repository's code.

This project is an independent integration and is not affiliated with or endorsed by the EntraScopes, ROADtools, or Microsoft maintainers.

## Development

```powershell
npm ci
npm run check
npm test
npm run build
npm pack --dry-run
```

The server uses the MCP TypeScript SDK v2 and stdio transport. Never write logs to stdout because stdout is the MCP protocol channel; operational messages go to stderr.

## Security

See [SECURITY.md](SECURITY.md). The server has no tenant credentials and makes only read-only HTTP GET requests to its configured dataset URLs. Review custom URL overrides before use because they change the server's network trust boundary.
