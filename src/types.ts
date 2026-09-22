export interface RawApplication {
  foci?: boolean;
  name?: string;
  preferred_interactive_redirurl?: string | null;
  preferred_noninteractive_redirurl?: string | null;
  public_client?: boolean;
  redirect_uris?: unknown;
  scopes?: unknown;
}

export interface RawScopeDataset {
  apps: Record<string, RawApplication>;
}

export interface RawResource {
  resourceId: string;
  displayName: string;
  identifierUris: string[];
  aliases: string[];
}

export interface ResourceGrant {
  resourceId: string;
  resourceName: string | null;
  resourceAliases: string[];
  scopes: string[];
}

export interface EntraApplication {
  appId: string;
  name: string;
  foci: boolean;
  publicClient: boolean;
  preferredInteractiveRedirectUri: string | null;
  preferredNoninteractiveRedirectUri: string | null;
  redirectUris: string[];
  grants: ResourceGrant[];
}

export type DataOrigin = "remote" | "cache-fresh" | "cache-stale";

export interface DataSnapshot {
  applications: EntraApplication[];
  fetchedAt: string;
  origin: DataOrigin;
  scopesUrl: string;
  resourcesUrl: string;
  applicationCount: number;
  grantCount: number;
}
