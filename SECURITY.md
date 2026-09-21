# Security policy

## Reporting a vulnerability

Please report vulnerabilities through GitHub's private vulnerability reporting feature for this repository. Do not include tenant identifiers, access tokens, secrets, or other sensitive Microsoft Entra data in an issue.

## Trust boundary

`mcp-entrascopes` does not authenticate to Microsoft Entra ID or Microsoft Graph. It reads public JSON datasets from configured HTTPS URLs and writes a local cache. Tool inputs cannot change those URLs.

Treat these environment variables as trusted process configuration:

- `ENTRASCOPES_SCOPES_URL`
- `ENTRASCOPES_RESOURCES_URL`
- `ENTRASCOPES_CACHE_DIR`

Results are informational metadata, not evidence of tenant consent, effective permissions, token issuance, or access authorization.
