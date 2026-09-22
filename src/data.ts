import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { BUILT_IN_RESOURCE_ALIASES } from "./resource-aliases.js";
import type {
  DataOrigin,
  DataSnapshot,
  EntraApplication,
  RawApplication,
  RawResource,
  RawScopeDataset,
  ResourceGrant,
} from "./types.js";

export const DEFAULT_SCOPES_URL =
  "https://raw.githubusercontent.com/dirkjanm/ROADtools/refs/heads/master/roadtx/roadtools/roadtx/firstpartyscopes.json";
export const DEFAULT_RESOURCES_URL =
  "https://raw.githubusercontent.com/f-bader/entrascopes.com/refs/heads/main/resources.json";

interface CacheDocument {
  version: 1;
  fetchedAt: string;
  scopesData: unknown;
  resourcesData: unknown;
}

interface ProviderOptions {
  scopesUrl?: string;
  resourcesUrl?: string;
  cacheFile?: string;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseScopeDataset(value: unknown): RawScopeDataset {
  if (!isRecord(value) || !isRecord(value.apps)) {
    throw new Error("The scope dataset does not contain an apps object.");
  }

  return { apps: value.apps as Record<string, RawApplication> };
}

function parseResources(value: unknown): RawResource[] {
  if (!Array.isArray(value)) {
    throw new Error("The resource dataset is not an array.");
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.resourceId !== "string" ||
      typeof item.displayName !== "string"
    ) {
      return [];
    }
    return [{
      resourceId: item.resourceId,
      displayName: item.displayName,
      identifierUris: stringArray(item.identifierUris ?? item.identifier_uris),
      aliases: stringArray(item.aliases),
    }];
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeDatasets(
  scopesValue: unknown,
  resourcesValue: unknown,
): EntraApplication[] {
  const scopeDataset = parseScopeDataset(scopesValue);
  const resources = parseResources(resourcesValue);
  const resourceMetadata = new Map(
    resources.map((resource) => {
      const resourceId = resource.resourceId.toLowerCase();
      return [
        resourceId,
        {
          name: resource.displayName.trim(),
          aliases: uniqueStrings([
            ...resource.identifierUris,
            ...resource.aliases,
            ...(BUILT_IN_RESOURCE_ALIASES[resourceId] ?? []),
          ]),
        },
      ];
    }),
  );

  return Object.entries(scopeDataset.apps)
    .flatMap(([appId, rawApp]) => {
      if (!isRecord(rawApp)) return [];

      const rawScopes = isRecord(rawApp.scopes) ? rawApp.scopes : {};
      const grants: ResourceGrant[] = Object.entries(rawScopes)
        .map(([resourceId, scopes]) => {
          const metadata = resourceMetadata.get(resourceId.toLowerCase());
          return {
            resourceId,
            resourceName: metadata?.name ?? null,
            resourceAliases: uniqueStrings([
              ...(metadata?.aliases ?? []),
              ...(BUILT_IN_RESOURCE_ALIASES[resourceId.toLowerCase()] ?? []),
            ]),
            scopes: stringArray(scopes).sort((left, right) => left.localeCompare(right)),
          };
        })
        .filter((grant) => grant.scopes.length > 0)
        .sort((left, right) =>
          (left.resourceName ?? left.resourceId).localeCompare(
            right.resourceName ?? right.resourceId,
          ),
        );

      return [
        {
          appId,
          name: typeof rawApp.name === "string" ? rawApp.name.trim() : appId,
          foci: rawApp.foci === true,
          publicClient: rawApp.public_client === true,
          preferredInteractiveRedirectUri:
            typeof rawApp.preferred_interactive_redirurl === "string"
              ? rawApp.preferred_interactive_redirurl
              : null,
          preferredNoninteractiveRedirectUri:
            typeof rawApp.preferred_noninteractive_redirurl === "string"
              ? rawApp.preferred_noninteractive_redirurl
              : null,
          redirectUris: stringArray(rawApp.redirect_uris),
          grants,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function defaultCacheFile(): string {
  const cacheRoot =
    process.env.ENTRASCOPES_CACHE_DIR ??
    (process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "mcp-entrascopes")
      : join(homedir(), ".cache", "mcp-entrascopes"));
  return join(cacheRoot, "datasets.json");
}

function configuredTtlMs(): number {
  const minutes = Number.parseFloat(process.env.ENTRASCOPES_CACHE_TTL_MINUTES ?? "60");
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 3_600_000;
}

export class EntraScopesDataProvider {
  readonly scopesUrl: string;
  readonly resourcesUrl: string;
  readonly cacheFile: string;
  readonly cacheTtlMs: number;

  private readonly fetcher: typeof fetch;
  private memory: DataSnapshot | undefined;
  private pending: Promise<DataSnapshot> | undefined;

  constructor(options: ProviderOptions = {}) {
    this.scopesUrl = options.scopesUrl ?? process.env.ENTRASCOPES_SCOPES_URL ?? DEFAULT_SCOPES_URL;
    this.resourcesUrl =
      options.resourcesUrl ?? process.env.ENTRASCOPES_RESOURCES_URL ?? DEFAULT_RESOURCES_URL;
    this.cacheFile = options.cacheFile ?? defaultCacheFile();
    this.cacheTtlMs = options.cacheTtlMs ?? configuredTtlMs();
    this.fetcher = options.fetcher ?? fetch;
  }

  async getSnapshot(forceRefresh = false): Promise<DataSnapshot> {
    if (!forceRefresh && this.memory && this.isFresh(this.memory.fetchedAt)) {
      return this.memory;
    }
    if (!forceRefresh && this.pending) return this.pending;

    this.pending = this.load(forceRefresh).finally(() => {
      this.pending = undefined;
    });
    const snapshot = await this.pending;
    this.memory = snapshot;
    return snapshot;
  }

  private isFresh(fetchedAt: string): boolean {
    return Date.now() - Date.parse(fetchedAt) <= this.cacheTtlMs;
  }

  private async readCache(): Promise<CacheDocument | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.cacheFile, "utf8")) as unknown;
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        typeof parsed.fetchedAt !== "string" ||
        !("scopesData" in parsed) ||
        !("resourcesData" in parsed)
      ) {
        return undefined;
      }
      return parsed as unknown as CacheDocument;
    } catch {
      return undefined;
    }
  }

  private async writeCache(document: CacheDocument): Promise<void> {
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true });
      await writeFile(this.cacheFile, JSON.stringify(document), "utf8");
    } catch (error) {
      console.error(`mcp-entrascopes: unable to write cache: ${String(error)}`);
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { "user-agent": "mcp-entrascopes/0.2.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }
    return response.json() as Promise<unknown>;
  }

  private snapshotFromCache(document: CacheDocument, origin: DataOrigin): DataSnapshot {
    return this.createSnapshot(
      document.scopesData,
      document.resourcesData,
      document.fetchedAt,
      origin,
    );
  }

  private createSnapshot(
    scopesData: unknown,
    resourcesData: unknown,
    fetchedAt: string,
    origin: DataOrigin,
  ): DataSnapshot {
    const applications = normalizeDatasets(scopesData, resourcesData);
    return {
      applications,
      fetchedAt,
      origin,
      scopesUrl: this.scopesUrl,
      resourcesUrl: this.resourcesUrl,
      applicationCount: applications.length,
      grantCount: applications.reduce(
        (count, application) =>
          count + application.grants.reduce((subtotal, grant) => subtotal + grant.scopes.length, 0),
        0,
      ),
    };
  }

  private async load(forceRefresh: boolean): Promise<DataSnapshot> {
    const cached = await this.readCache();
    if (!forceRefresh && cached && this.isFresh(cached.fetchedAt)) {
      return this.snapshotFromCache(cached, "cache-fresh");
    }

    try {
      const scopesData = await this.fetchJson(this.scopesUrl);
      let resourcesData: unknown = cached?.resourcesData ?? [];
      try {
        resourcesData = await this.fetchJson(this.resourcesUrl);
      } catch (error) {
        console.error(`mcp-entrascopes: resource-name enrichment unavailable: ${String(error)}`);
      }

      const document: CacheDocument = {
        version: 1,
        fetchedAt: new Date().toISOString(),
        scopesData,
        resourcesData,
      };
      const snapshot = this.snapshotFromCache(document, "remote");
      await this.writeCache(document);
      return snapshot;
    } catch (error) {
      if (!cached) throw error;
      console.error(`mcp-entrascopes: using stale cache after refresh failed: ${String(error)}`);
      return this.snapshotFromCache(cached, "cache-stale");
    }
  }
}
