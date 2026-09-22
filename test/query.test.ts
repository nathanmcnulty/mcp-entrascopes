import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDatasets } from "../src/data.js";
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
