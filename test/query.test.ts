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

test("searches app names case-insensitively and applies boolean filters", () => {
  const result = searchApplications(snapshot, {
    query: "admin",
    foci: true,
    publicClient: true,
  });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.applications[0]?.appId, "11111111-1111-1111-1111-111111111111");
});

test("requires at least one search criterion", () => {
  assert.throws(() => searchApplications(snapshot, {}), /at least one/i);
});

test("gets an exact app and omits redirect URIs by default", () => {
  const result = getApplication(
    snapshot,
    "11111111-1111-1111-1111-111111111111",
    undefined,
    false,
  );

  assert.equal(result?.name, "Example Admin");
  assert.equal("redirectUris" in (result ?? {}), false);
  assert.equal(result?.scopeCount, 2);
});
