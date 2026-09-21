import type { DataSnapshot, EntraApplication, ResourceGrant } from "./types.js";

export type ScopeMatch = "exact" | "contains";

export interface SearchOptions {
  query?: string;
  scope?: string;
  resource?: string;
  scopeMatch?: ScopeMatch;
  foci?: boolean;
  publicClient?: boolean;
  limit?: number;
}

function includes(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.trim().toLowerCase());
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
    (grant.resourceName !== null && includes(grant.resourceName, resource));
  if (!resourceMatches) return false;
  if (scope === undefined) return true;

  const normalizedScope = scope.trim().toLowerCase();
  return grant.scopes.some((candidate) =>
    scopeMatch === "exact"
      ? candidate.toLowerCase() === normalizedScope
      : candidate.toLowerCase().includes(normalizedScope),
  );
}

function matchingGrantSummary(
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
    scopes,
  };
}

export function searchApplications(snapshot: DataSnapshot, options: SearchOptions) {
  const scopeMatch = options.scopeMatch ?? "exact";
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  const query = options.query?.trim();
  const scope = options.scope?.trim();
  const resource = options.resource?.trim();

  if (!query && !scope && !resource && options.foci === undefined && options.publicClient === undefined) {
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
    return [
      {
        appId: application.appId,
        name: application.name,
        foci: application.foci,
        publicClient: application.publicClient,
        resourceCount: application.grants.length,
        scopeCount,
        matchingGrants: (scope || resource)
          ? matchingGrants.slice(0, 20).map((grant) =>
              matchingGrantSummary(grant, scope, scopeMatch),
            )
          : [],
      },
    ];
  });

  return {
    criteria: {
      query: query ?? null,
      scope: scope ?? null,
      resource: resource ?? null,
      scopeMatch,
      foci: options.foci ?? null,
      publicClient: options.publicClient ?? null,
    },
    totalMatches: matches.length,
    returned: Math.min(matches.length, limit),
    truncated: matches.length > limit,
    applications: matches.slice(0, limit),
    data: dataSummary(snapshot),
  };
}

export function getApplication(
  snapshot: DataSnapshot,
  appId: string,
  resource: string | undefined,
  includeRedirectUris: boolean,
) {
  const application = snapshot.applications.find(
    (candidate) => candidate.appId.toLowerCase() === appId.trim().toLowerCase(),
  );
  if (!application) return null;

  const grants = resource
    ? application.grants.filter((grant) => grantMatches(grant, undefined, resource, "exact"))
    : application.grants;

  return {
    appId: application.appId,
    name: application.name,
    foci: application.foci,
    publicClient: application.publicClient,
    preferredInteractiveRedirectUri: application.preferredInteractiveRedirectUri,
    preferredNoninteractiveRedirectUri: application.preferredNoninteractiveRedirectUri,
    ...(includeRedirectUris ? { redirectUris: application.redirectUris } : {}),
    resourceFilter: resource ?? null,
    resourceCount: grants.length,
    scopeCount: grants.reduce((count, grant) => count + grant.scopes.length, 0),
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
