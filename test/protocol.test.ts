import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createTestSnapshot } from "../src/query.js";
import { createServer } from "../src/server.js";
import type { EntraApplication } from "../src/types.js";

const fixture: EntraApplication = {
  appId: "11111111-1111-1111-1111-111111111111",
  name: "Protocol Test App",
  foci: false,
  publicClient: true,
  preferredInteractiveRedirectUri: null,
  preferredNoninteractiveRedirectUri: null,
  redirectUris: [],
  grants: [
    {
      resourceId: "00000003-0000-0000-c000-000000000000",
      resourceName: "Microsoft Graph",
      resourceAliases: ["https://graph.microsoft.com"],
      scopes: ["User.Read"],
    },
  ],
};

test("lists and calls tools through MCP", async () => {
  const server = createServer({
    getSnapshot: async () => createTestSnapshot([fixture]),
    getScopeHistory: async () => ({
      base: {
        revision: {
          sha: "a".repeat(40),
          committedAt: "2026-09-20T00:00:00.000Z",
          message: "before",
          url: "https://example.test/before",
          sourceUrl: "https://example.test/before.json",
        },
        snapshot: createTestSnapshot([]),
      },
      head: {
        revision: {
          sha: "b".repeat(40),
          committedAt: "2026-09-21T00:00:00.000Z",
          message: "after",
          url: "https://example.test/after",
          sourceUrl: "https://example.test/after.json",
        },
        snapshot: createTestSnapshot([fixture]),
      },
    }),
  });
  const client = new Client({ name: "mcp-entrascopes-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "compare_entrascopes_scope_history",
        "get_entra_application",
        "get_entrascopes_data_status",
        "search_entra_applications",
      ],
    );

    const response = await client.callTool({
      name: "search_entra_applications",
      arguments: { scope: "User.Read" },
    });
    assert.equal(response.isError, undefined);
    assert.equal(
      (response.structuredContent as { totalMatches?: number } | undefined)?.totalMatches,
      1,
    );

    const historyResponse = await client.callTool({
      name: "compare_entrascopes_scope_history",
      arguments: { scope: "User.Read" },
    });
    assert.equal(historyResponse.isError, undefined);
    assert.equal(
      (historyResponse.structuredContent as { totalMatches?: number } | undefined)
        ?.totalMatches,
      1,
    );

    const uriResponse = await client.callTool({
      name: "search_entra_applications",
      arguments: { resource: "graph.microsoft.com" },
    });
    assert.equal(
      (uriResponse.structuredContent as { totalMatches?: number } | undefined)?.totalMatches,
      1,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
