const DEFENDER_ENDPOINTS = [
  "https://api.security.microsoft.com",
  "https://api.securitycenter.microsoft.com",
];

/**
 * Query aliases for well-known Microsoft resources whose API hostname differs
 * from the resource display name. These are lookup conveniences, not claims
 * about the token audience accepted by every endpoint.
 */
export const BUILT_IN_RESOURCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "00000003-0000-0000-c000-000000000000": ["https://graph.microsoft.com"],
  "797f4846-ba00-4fd7-ba43-dac1f8f63013": [
    "https://management.azure.com",
    "https://management.core.windows.net",
  ],
  "fc780465-2017-40d4-a0c5-307022471b92": DEFENDER_ENDPOINTS,
};
