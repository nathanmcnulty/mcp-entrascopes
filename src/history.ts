import { resourceMatches, type ScopeMatch } from "./query.js";
import type { DataSnapshot, ResourceGrant, ScopeHistory } from "./types.js";

export interface HistoryComparisonOptions {
  appId?: string;
  query?: string;
  resource?: string;
  scope?: string;
  scopeMatch?: ScopeMatch;
  change?: "added" | "removed" | "all";
  offset?: number;
  limit?: number;
}

interface ScopeEntry {
  appId: string;
  appName: string;
  grant: ResourceGrant;
  scope: string;
}

function includes(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function entryKey(entry: ScopeEntry): string {
  return `${entry.appId.toLowerCase()}\0${entry.grant.resourceId.toLowerCase()}\0${entry.scope}`;
}

function flatten(snapshot: DataSnapshot): Map<string, ScopeEntry> {
  const entries = new Map<string, ScopeEntry>();
  for (const application of snapshot.applications) {
    for (const grant of application.grants) {
      for (const scope of grant.scopes) {
        const entry = { appId: application.appId, appName: application.name, grant, scope };
        entries.set(entryKey(entry), entry);
      }
    }
  }
  return entries;
}

function changeSummary(entry: ScopeEntry, change: "added" | "removed") {
  return {
    change,
    appId: entry.appId,
    appName: entry.appName,
    resourceId: entry.grant.resourceId,
    resourceName: entry.grant.resourceName,
    ...(entry.grant.resourceAliases.length > 0
      ? { resourceAliases: entry.grant.resourceAliases }
      : {}),
    scope: entry.scope,
  };
}

export function compareScopeHistory(
  history: ScopeHistory,
  options: HistoryComparisonOptions = {},
) {
  const before = flatten(history.base.snapshot);
  const after = flatten(history.head.snapshot);
  const allChanges = [
    ...[...after].flatMap(([key, entry]) =>
      before.has(key) ? [] : [changeSummary(entry, "added")],
    ),
    ...[...before].flatMap(([key, entry]) =>
      after.has(key) ? [] : [changeSummary(entry, "removed")],
    ),
  ].sort(
    (left, right) =>
      left.appName.localeCompare(right.appName) ||
      (left.resourceName ?? left.resourceId).localeCompare(
        right.resourceName ?? right.resourceId,
      ) ||
      left.scope.localeCompare(right.scope) ||
      left.change.localeCompare(right.change),
  );

  const appId = options.appId?.trim().toLowerCase();
  const query = options.query?.trim();
  const resource = options.resource?.trim();
  const scope = options.scope?.trim().toLowerCase();
  const scopeMatch = options.scopeMatch ?? "exact";
  const change = options.change ?? "all";
  const filtered = allChanges.filter((candidate) => {
    if (appId && candidate.appId.toLowerCase() !== appId) return false;
    if (query && !includes(candidate.appName, query) && !includes(candidate.appId, query)) {
      return false;
    }
    if (
      !resourceMatches(
        {
          resourceId: candidate.resourceId,
          resourceName: candidate.resourceName,
          resourceAliases: candidate.resourceAliases ?? [],
          scopes: [candidate.scope],
        },
        resource,
      )
    ) {
      return false;
    }
    if (
      scope &&
      (scopeMatch === "exact"
        ? candidate.scope.toLowerCase() !== scope
        : !candidate.scope.toLowerCase().includes(scope))
    ) {
      return false;
    }
    return change === "all" || candidate.change === change;
  });

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const changes = filtered.slice(offset, offset + limit);
  const nextOffset = offset + changes.length;

  return {
    comparison: {
      base: history.base.revision,
      head: history.head.revision,
      url: `https://github.com/dirkjanm/ROADtools/compare/${history.base.revision.sha}...${history.head.revision.sha}`,
    },
    criteria: {
      appId: options.appId?.trim() ?? null,
      query: query ?? null,
      resource: resource ?? null,
      scope: options.scope?.trim() ?? null,
      scopeMatch,
      change,
    },
    summary: {
      totalAdded: allChanges.filter((candidate) => candidate.change === "added").length,
      totalRemoved: allChanges.filter((candidate) => candidate.change === "removed").length,
      matchingAdded: filtered.filter((candidate) => candidate.change === "added").length,
      matchingRemoved: filtered.filter((candidate) => candidate.change === "removed").length,
    },
    totalMatches: filtered.length,
    offset,
    limit,
    returned: changes.length,
    truncated: nextOffset < filtered.length,
    nextOffset: nextOffset < filtered.length ? nextOffset : null,
    changes,
    permissionModel:
      "Changes are exact published delegated OAuth scope strings (scp), keyed by application ID and resource ID. Application roles (roles) are not compared.",
    caveat:
      "A published metadata change is not proof that Microsoft issued or accepted the corresponding scope in a token.",
  };
}
