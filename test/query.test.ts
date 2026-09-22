import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDatasets } from "../src/data.js";
import { compareScopeHistory } from "../src/history.js";
import {
  createTestSnapshot,
  getApplication,
  searchApplications,
} from "../src/query.js";

const applications = normalizeDatasets(
  {
    apps: {
      "11111111-1111-1111-1111-111111111111": {
        name: "Example Admin",
        foci: true,
        public_client: true,
        redirect_uris: ["http://localhost"],
        scopes: {
          "00000003-0000-0000-c000-000000000000": [
            "Application.Read.All",
            "User.Read",
          ],
        },
      },
      "22222222-2222-2222-2222-222222222222": {
        name: "Example Reader",
        scopes: {
          "00000003-0000-0000-c000-000000000000": ["User.Read"],
        },
      },
    },
  },
  [
    {
      resourceId: "00000003-0000-0000-c000-000000000000",
      displayName: "Microsoft Graph",
      identifierUris: ["https://graph.microsoft.com"],
    },
  ],
);

const snapshot = createTestSnapshot(applications);

function revision(sha: string) {
  return {
    sha,
    committedAt: "2026-09-21T00:00:00.000Z",
    message: "update scopes",
    url: `https://example.test/commit/${sha}`,
    sourceUrl: `https://example.test/raw/${sha}/scopes.json`,
  };
}

test("normalizes application and resource metadata", () => {
  assert.equal(snapshot.applicationCount, 2);
  assert.equal(snapshot.grantCount, 3);
  assert.equal(applications[0]?.grants[0]?.resourceName, "Microsoft Graph");
});

test("searches by exact scope and resource name", () => {
  const result = searchApplications(snapshot, {
    scope: "Application.Read.All",
    resource: "Microsoft Graph",
  });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.applications[0]?.name, "Example Admin");
  assert.deepEqual(result.applications[0]?.matchingGrants[0]?.scopes, [
    "Application.Read.All",
  ]);
});

test("searches resources by identifier URI", () => {
  const result = searchApplications(snapshot, {
    resource: "https://graph.microsoft.com/v1.0/users",
  });

  assert.equal(result.totalMatches, 2);
  assert.equal(
    result.applications[0]?.matchingGrants[0]?.resourceId,
    "00000003-0000-0000-c000-000000000000",
  );
});

test("uses built-in aliases when upstream metadata has no identifier URIs", () => {
  const defenderApplications = normalizeDatasets(
    {
      apps: {
        "33333333-3333-3333-3333-333333333333": {
          name: "Defender Client",
          scopes: {
            "fc780465-2017-40d4-a0c5-307022471b92": ["Machine.Read"],
          },
        },
      },
    },
    [
      {
        resourceId: "fc780465-2017-40d4-a0c5-307022471b92",
        displayName: "WindowsDefenderATP",
      },
    ],
  );
  const result = searchApplications(createTestSnapshot(defenderApplications), {
    resource: "api.security.microsoft.com",
  });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.applications[0]?.name, "Defender Client");
});

test("searches app names case-insensitively and applies boolean filters", () => {
  const result = searchApplications(snapshot, {
    query: "admin",
    foci: true,
    publicClient: true,
  });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.applications[0]?.appId, "11111111-1111-1111-1111-111111111111");
});

test("searches applications by partial reply URI", () => {
  const result = searchApplications(snapshot, { redirectUri: "localhost" });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.applications[0]?.name, "Example Admin");
  assert.equal(result.criteria.redirectUri, "localhost");
  assert.deepEqual(result.applications[0]?.matchingRedirectUris, ["http://localhost"]);
});

test("paginates application search results", () => {
  const result = searchApplications(snapshot, { scope: "User.Read", limit: 1 });

  assert.equal(result.returned, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.applications[0]?.name, "Example Admin");

  const next = searchApplications(snapshot, {
    scope: "User.Read",
    offset: result.nextOffset ?? 0,
    limit: 1,
  });
  assert.equal(next.applications[0]?.name, "Example Reader");
  assert.equal(next.truncated, false);
});

test("requires at least one search criterion", () => {
  assert.throws(() => searchApplications(snapshot, {}), /at least one/i);
});

test("gets an exact app and omits redirect URIs by default", () => {
  const result = getApplication(
    snapshot,
    "11111111-1111-1111-1111-111111111111",
  );

  assert.equal(result?.name, "Example Admin");
  assert.equal("redirectUris" in (result ?? {}), false);
  assert.equal(result?.totalScopeCount, 2);
  assert.equal(result?.redirectUriCount, 1);
});

test("filters and paginates exact application grants", () => {
  const result = getApplication(
    snapshot,
    "11111111-1111-1111-1111-111111111111",
    {
      scope: "User.Read",
      limit: 1,
    },
  );

  assert.equal(result?.matchedResourceCount, 1);
  assert.equal(result?.returnedResourceCount, 1);
  assert.equal(result?.returnedScopeCount, 1);
  assert.deepEqual(result?.grants[0]?.scopes, ["User.Read"]);
});

test("reports historical scope additions and removals", () => {
  const before = createTestSnapshot(
    normalizeDatasets(
      {
        apps: {
          "11111111-1111-1111-1111-111111111111": {
            name: "Example Admin",
            scopes: {
              "00000003-0000-0000-c000-000000000000": ["Old.Scope", "User.Read"],
            },
          },
        },
      },
      [
        {
          resourceId: "00000003-0000-0000-c000-000000000000",
          displayName: "Microsoft Graph",
          identifierUris: ["https://graph.microsoft.com"],
        },
      ],
    ),
  );
  const after = createTestSnapshot(
    normalizeDatasets(
      {
        apps: {
          "11111111-1111-1111-1111-111111111111": {
            name: "Example Admin",
            scopes: {
              "00000003-0000-0000-c000-000000000000": ["New.Scope", "User.Read"],
            },
          },
        },
      },
      [
        {
          resourceId: "00000003-0000-0000-c000-000000000000",
          displayName: "Microsoft Graph",
          identifierUris: ["https://graph.microsoft.com"],
        },
      ],
    ),
  );

  const result = compareScopeHistory(
    {
      base: { revision: revision("a".repeat(40)), snapshot: before },
      head: { revision: revision("b".repeat(40)), snapshot: after },
    },
    { resource: "graph.microsoft.com", scope: ".Scope", scopeMatch: "contains" },
  );

  assert.equal(result.summary.totalAdded, 1);
  assert.equal(result.summary.totalRemoved, 1);
  assert.deepEqual(
    result.changes.map((change) => [change.change, change.scope]),
    [
      ["added", "New.Scope"],
      ["removed", "Old.Scope"],
    ],
  );
});

test("filters and paginates historical changes", () => {
  const before = createTestSnapshot([]);
  const result = compareScopeHistory(
    {
      base: { revision: revision("a".repeat(40)), snapshot: before },
      head: { revision: revision("b".repeat(40)), snapshot },
    },
    { change: "added", scope: "User.Read", limit: 1 },
  );

  assert.equal(result.totalMatches, 2);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.changes[0]?.change, "added");
});

test("treats scope value casing as an exact historical change", () => {
  const appId = "11111111-1111-1111-1111-111111111111";
  const resourceId = "00000003-0000-0000-c000-000000000000";
  const makeSnapshot = (scope: string, name: string) =>
    createTestSnapshot([
      {
        appId,
        name,
        foci: false,
        publicClient: false,
        preferredInteractiveRedirectUri: null,
        preferredNoninteractiveRedirectUri: null,
        redirectUris: [],
        grants: [
          {
            resourceId,
            resourceName: "Microsoft Graph",
            resourceAliases: ["https://graph.microsoft.com"],
            scopes: [scope],
          },
        ],
      },
    ]);
  const result = compareScopeHistory({
    base: {
      revision: revision("a".repeat(40)),
      snapshot: makeSnapshot("Scope.Read", "Old display name"),
    },
    head: {
      revision: revision("b".repeat(40)),
      snapshot: makeSnapshot("scope.read", "New display name"),
    },
  });

  assert.deepEqual(
    result.changes.map((change) => [change.change, change.scope]),
    [
      ["added", "scope.read"],
      ["removed", "Scope.Read"],
    ],
  );
});
