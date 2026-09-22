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
  ScopeHistory,
  ScopeRevision,
} from "./types.js";

const ROADTOOLS_OWNER = "dirkjanm";
const ROADTOOLS_REPOSITORY = "ROADtools";
const ROADTOOLS_SCOPES_PATH = "roadtx/roadtools/roadtx/firstpartyscopes.json";
const GITHUB_API_URL = "https://api.github.com";
const ROADTOOLS_RAW_URL = `https://raw.githubusercontent.com/${ROADTOOLS_OWNER}/${ROADTOOLS_REPOSITORY}`;
export const DEFAULT_SCOPES_URL =
  `${ROADTOOLS_RAW_URL}/refs/heads/master/${ROADTOOLS_SCOPES_PATH}`;
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
  githubToken?: string;
}

export interface ScopeHistoryOptions {
  baseRef?: string;
  headRef?: string;
  refresh?: boolean;
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

function parseRevision(value: unknown): ScopeRevision {
  if (!isRecord(value) || typeof value.sha !== "string" || !/^[0-9a-f]{40}$/i.test(value.sha)) {
    throw new Error("GitHub returned an invalid ROADtools revision.");
  }
  const commit = isRecord(value.commit) ? value.commit : {};
  const committer = isRecord(commit.committer) ? commit.committer : {};
  const author = isRecord(commit.author) ? commit.author : {};
  const committedAt =
    typeof committer.date === "string"
      ? committer.date
      : typeof author.date === "string"
        ? author.date
        : null;
  const sha = value.sha.toLowerCase();
  return {
    sha,
    committedAt,
    message: typeof commit.message === "string" ? commit.message : null,
    url:
      typeof value.html_url === "string"
        ? value.html_url
        : `https://github.com/${ROADTOOLS_OWNER}/${ROADTOOLS_REPOSITORY}/commit/${sha}`,
    sourceUrl: `${ROADTOOLS_RAW_URL}/${sha}/${ROADTOOLS_SCOPES_PATH}`,
  };
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
  private readonly githubToken: string | undefined;
  private memory: DataSnapshot | undefined;
  private pending: Promise<DataSnapshot> | undefined;
  private readonly history = new Map<
    string,
    { expiresAt: number; pending: Promise<ScopeHistory> }
  >();

  constructor(options: ProviderOptions = {}) {
    this.scopesUrl = options.scopesUrl ?? process.env.ENTRASCOPES_SCOPES_URL ?? DEFAULT_SCOPES_URL;
    this.resourcesUrl =
      options.resourcesUrl ?? process.env.ENTRASCOPES_RESOURCES_URL ?? DEFAULT_RESOURCES_URL;
    this.cacheFile = options.cacheFile ?? defaultCacheFile();
    this.cacheTtlMs = options.cacheTtlMs ?? configuredTtlMs();
    this.fetcher = options.fetcher ?? fetch;
    this.githubToken = options.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
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

  private async fetchJson(
    url: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { "user-agent": "mcp-entrascopes/0.3.0", ...extraHeaders },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const tokenHint =
        url.startsWith(GITHUB_API_URL) && response.status === 403
          ? " Set GITHUB_TOKEN for a higher GitHub API rate limit."
          : "";
      throw new Error(`HTTP ${response.status} while fetching ${url}.${tokenHint}`);
    }
    return response.json() as Promise<unknown>;
  }

  private githubHeaders(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(this.githubToken ? { authorization: `Bearer ${this.githubToken}` } : {}),
    };
  }

  private async listScopeRevisions(headRef?: string): Promise<ScopeRevision[]> {
    const url = new URL(
      `${GITHUB_API_URL}/repos/${ROADTOOLS_OWNER}/${ROADTOOLS_REPOSITORY}/commits`,
    );
    url.searchParams.set("path", ROADTOOLS_SCOPES_PATH);
    url.searchParams.set("per_page", "2");
    if (headRef) url.searchParams.set("sha", headRef);
    const value = await this.fetchJson(url.toString(), this.githubHeaders());
    if (!Array.isArray(value)) {
      throw new Error("GitHub did not return ROADtools revision history.");
    }
    return value.map(parseRevision);
  }

  private async getRevision(sha: string): Promise<ScopeRevision> {
    const value = await this.fetchJson(
      `${GITHUB_API_URL}/repos/${ROADTOOLS_OWNER}/${ROADTOOLS_REPOSITORY}/commits/${sha}`,
      this.githubHeaders(),
    );
    return parseRevision(value);
  }

  private resourceMetadata(snapshot: DataSnapshot): RawResource[] {
    const resources = new Map<string, RawResource>();
    for (const application of snapshot.applications) {
      for (const grant of application.grants) {
        const key = grant.resourceId.toLowerCase();
        if (!resources.has(key)) {
          resources.set(key, {
            resourceId: grant.resourceId,
            displayName: grant.resourceName ?? grant.resourceId,
            identifierUris: grant.resourceAliases,
            aliases: [],
          });
        }
      }
    }
    return [...resources.values()];
  }

  async getScopeHistory(options: ScopeHistoryOptions = {}): Promise<ScopeHistory> {
    const shaPattern = /^[0-9a-f]{40}$/i;
    if (options.baseRef && !shaPattern.test(options.baseRef)) {
      throw new Error("base_ref must be a full 40-character Git commit SHA.");
    }
    if (options.headRef && !shaPattern.test(options.headRef)) {
      throw new Error("head_ref must be a full 40-character Git commit SHA.");
    }

    const key = `${options.baseRef?.toLowerCase() ?? "previous"}:${options.headRef?.toLowerCase() ?? "latest"}`;
    const existing = this.history.get(key);
    if (!options.refresh && existing && Date.now() <= existing.expiresAt) {
      return existing.pending;
    }

    const pending = (async () => {
      const revisions = await this.listScopeRevisions(options.headRef);
      if (revisions.length < 2 && !options.baseRef) {
        throw new Error("ROADtools does not have two scope dataset revisions to compare.");
      }
      const head = options.headRef
        ? await this.getRevision(options.headRef)
        : revisions[0];
      if (!head) throw new Error("ROADtools scope dataset revision history is empty.");
      const base = options.baseRef
        ? await this.getRevision(options.baseRef)
        : revisions[1];
      if (!base) throw new Error("Unable to resolve a base ROADtools scope revision.");
      if (base.sha === head.sha) {
        throw new Error("The base and head scope revisions must be different.");
      }

      const current = await this.getSnapshot();
      const resources = this.resourceMetadata(current);
      const [baseData, headData] = await Promise.all([
        this.fetchJson(base.sourceUrl),
        this.fetchJson(head.sourceUrl),
      ]);
      return {
        base: {
          revision: base,
          snapshot: this.createSnapshot(
            baseData,
            resources,
            base.committedAt ?? new Date().toISOString(),
            "remote",
            base.sourceUrl,
          ),
        },
        head: {
          revision: head,
          snapshot: this.createSnapshot(
            headData,
            resources,
            head.committedAt ?? new Date().toISOString(),
            "remote",
            head.sourceUrl,
          ),
        },
      };
    })();
    this.history.set(key, { expiresAt: Date.now() + this.cacheTtlMs, pending });
    try {
      return await pending;
    } catch (error) {
      this.history.delete(key);
      throw error;
    }
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
    scopesUrl = this.scopesUrl,
  ): DataSnapshot {
    const applications = normalizeDatasets(scopesData, resourcesData);
    return {
      applications,
      fetchedAt,
      origin,
      scopesUrl,
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
