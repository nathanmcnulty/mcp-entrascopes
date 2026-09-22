import type { DataSnapshot, EntraApplication, ResourceGrant } from "./types.js";

export type ScopeMatch = "exact" | "contains";

export interface SearchOptions {
  query?: string;
  scope?: string;
  resource?: string;
  redirectUri?: string;
  scopeMatch?: ScopeMatch;
  foci?: boolean;
  publicClient?: boolean;
  offset?: number;
  limit?: number;
}

export interface GetApplicationOptions {
  resource?: string;
  scope?: string;
  scopeMatch?: ScopeMatch;
  includeRedirectUris?: boolean;
  offset?: number;
  limit?: number;
}

function includes(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function normalizedResource(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^https?:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      // Fall back to string normalization for a partial or malformed URI.
    }
  }
  return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function grantMatches(
  grant: ResourceGrant,
  scope: string | undefined,
  resource: string | undefined,
  scopeMatch: ScopeMatch,
): boolean {
  const resourceMatches =
    resource === undefined ||
    includes(grant.resourceId, resource) ||
    (grant.resourceName !== null && includes(grant.resourceName, resource)) ||
    grant.resourceAliases.some((alias) =>
      normalizedResource(alias).includes(normalizedResource(resource)),
    );
  if (!resourceMatches) return false;
  if (scope === undefined) return true;

  const normalizedScope = scope.trim().toLowerCase();
  return grant.scopes.some((candidate) =>
    scopeMatch === "exact"
      ? candidate.toLowerCase() === normalizedScope
      : candidate.toLowerCase().includes(normalizedScope),
  );
}

function grantSummary(
  grant: ResourceGrant,
  scope: string | undefined,
  scopeMatch: ScopeMatch,
) {
  const normalizedScope = scope?.trim().toLowerCase();
  const scopes =
    normalizedScope === undefined
      ? grant.scopes
      : grant.scopes.filter((candidate) =>
          scopeMatch === "exact"
            ? candidate.toLowerCase() === normalizedScope
            : candidate.toLowerCase().includes(normalizedScope),
        );
  return {
    resourceId: grant.resourceId,
    resourceName: grant.resourceName,
    ...(grant.resourceAliases.length > 0
      ? { resourceAliases: grant.resourceAliases }
      : {}),
    scopes,
  };
}

export function searchApplications(snapshot: DataSnapshot, options: SearchOptions) {
  const scopeMatch = options.scopeMatch ?? "exact";
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  const query = options.query?.trim();
  const scope = options.scope?.trim();
  const resource = options.resource?.trim();
  const redirectUri = options.redirectUri?.trim();

  if (
    !query &&
    !scope &&
    !resource &&
    !redirectUri &&
    options.foci === undefined &&
    options.publicClient === undefined
  ) {
    throw new Error("Provide at least one search criterion.");
  }

  const matches = snapshot.applications.flatMap((application) => {
    if (
      query &&
      !includes(application.name, query) &&
      !includes(application.appId, query)
    ) {
      return [];
    }
    if (options.foci !== undefined && application.foci !== options.foci) return [];
    if (
      redirectUri &&
      !application.redirectUris.some((candidate) => includes(candidate, redirectUri))
    ) {
      return [];
    }
    if (
      options.publicClient !== undefined &&
      application.publicClient !== options.publicClient
    ) {
      return [];
    }

    const matchingGrants = application.grants.filter((grant) =>
      grantMatches(grant, scope, resource, scopeMatch),
    );
    if ((scope || resource) && matchingGrants.length === 0) return [];

    const scopeCount = application.grants.reduce(
      (count, grant) => count + grant.scopes.length,
      0,
    );
    const matchingRedirectUris = redirectUri
      ? application.redirectUris.filter((candidate) => includes(candidate, redirectUri))
      : [];
    return [
      {
        appId: application.appId,
        name: application.name,
        foci: application.foci,
        publicClient: application.publicClient,
        resourceCount: application.grants.length,
        scopeCount,
        totalMatchingResourceCount: matchingGrants.length,
        matchingGrantsTruncated: matchingGrants.length > 20,
        matchingGrants: (scope || resource)
          ? matchingGrants.slice(0, 20).map((grant) => grantSummary(grant, scope, scopeMatch))
          : [],
        totalMatchingRedirectUriCount: matchingRedirectUris.length,
        matchingRedirectUrisTruncated: matchingRedirectUris.length > 20,
        matchingRedirectUris: matchingRedirectUris.slice(0, 20),
      },
    ];
  });

  const applications = matches.slice(offset, offset + limit);
  const nextOffset = offset + applications.length;

  return {
    criteria: {
      query: query ?? null,
      scope: scope ?? null,
      resource: resource ?? null,
      redirectUri: redirectUri ?? null,
      scopeMatch,
      foci: options.foci ?? null,
      publicClient: options.publicClient ?? null,
    },
    totalMatches: matches.length,
    offset,
    limit,
    returned: applications.length,
    truncated: nextOffset < matches.length,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
    applications,
    data: dataSummary(snapshot),
  };
}

export function getApplication(
  snapshot: DataSnapshot,
  appId: string,
  options: GetApplicationOptions = {},
) {
  const application = snapshot.applications.find(
    (candidate) => candidate.appId.toLowerCase() === appId.trim().toLowerCase(),
  );
  if (!application) return null;

  const scopeMatch = options.scopeMatch ?? "exact";
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const resource = options.resource?.trim();
  const scope = options.scope?.trim();
  const matchedGrants = application.grants.filter((grant) =>
    grantMatches(grant, scope, resource, scopeMatch),
  );
  const grants = matchedGrants
    .slice(offset, offset + limit)
    .map((grant) => grantSummary(grant, scope, scopeMatch));
  const nextOffset = offset + grants.length;

  return {
    appId: application.appId,
    name: application.name,
    foci: application.foci,
    publicClient: application.publicClient,
    preferredInteractiveRedirectUri: application.preferredInteractiveRedirectUri,
    preferredNoninteractiveRedirectUri: application.preferredNoninteractiveRedirectUri,
    redirectUriCount: application.redirectUris.length,
    ...(options.includeRedirectUris ? { redirectUris: application.redirectUris } : {}),
    resourceFilter: resource ?? null,
    scopeFilter: scope ?? null,
    scopeMatch,
    totalResourceCount: application.grants.length,
    totalScopeCount: application.grants.reduce(
      (count, grant) => count + grant.scopes.length,
      0,
    ),
    matchedResourceCount: matchedGrants.length,
    matchedScopeCount: matchedGrants.reduce(
      (count, grant) => count + grantSummary(grant, scope, scopeMatch).scopes.length,
      0,
    ),
    offset,
    limit,
    returnedResourceCount: grants.length,
    returnedScopeCount: grants.reduce((count, grant) => count + grant.scopes.length, 0),
    truncated: nextOffset < matchedGrants.length,
    nextOffset: nextOffset < matchedGrants.length ? nextOffset : null,
    grants,
    data: dataSummary(snapshot),
  };
}

export function dataSummary(snapshot: DataSnapshot) {
  return {
    fetchedAt: snapshot.fetchedAt,
    origin: snapshot.origin,
    applicationCount: snapshot.applicationCount,
    grantCount: snapshot.grantCount,
    scopesUrl: snapshot.scopesUrl,
    resourcesUrl: snapshot.resourcesUrl,
    permissionModel:
      "Scope values are upstream delegated OAuth scope claims (scp). Application roles (roles) are not inferred.",
    caveat:
      "Published Microsoft first-party application scope metadata; not tenant state or proof that consent exists in a specific tenant.",
  };
}

export function createTestSnapshot(applications: EntraApplication[]): DataSnapshot {
  return {
    applications,
    fetchedAt: "2026-09-21T00:00:00.000Z",
    origin: "remote",
    scopesUrl: "https://example.test/scopes.json",
    resourcesUrl: "https://example.test/resources.json",
    applicationCount: applications.length,
    grantCount: applications.reduce(
      (count, application) =>
        count + application.grants.reduce((subtotal, grant) => subtotal + grant.scopes.length, 0),
      0,
    ),
  };
}
