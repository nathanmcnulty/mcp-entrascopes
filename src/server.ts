import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { EntraScopesDataProvider } from "./data.js";
import { compareScopeHistory } from "./history.js";
import { dataSummary, getApplication, searchApplications } from "./query.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const guidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Expected a GUID-formatted application ID.",
  );
const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/i, "Expected a full 40-character Git commit SHA.");

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createServer(
  provider: Pick<EntraScopesDataProvider, "getSnapshot" | "getScopeHistory"> =
    new EntraScopesDataProvider(),
): McpServer {
  const server = new McpServer(
    { name: "mcp-entrascopes", version: "0.3.0" },
    {
      instructions:
        "Use this read-only server to inspect published Microsoft first-party application scope metadata. Results describe upstream delegated-scope metadata, not app roles, tenant grants, or proof of consent. Use search_entra_applications to find apps with a requested scope. Use compare_entrascopes_scope_history for additions and removals between immutable ROADtools revisions. Cite returned provenance when the distinction matters.",
    },
  );

  server.registerTool(
    "compare_entrascopes_scope_history",
    {
      title: "Compare historical Entra scope metadata",
      description:
        "Compare exact delegated-scope strings between immutable ROADtools revisions. Defaults to the latest two revisions that changed the scope dataset and supports bounded filters for agent reports.",
      inputSchema: z.object({
        base_ref: shaSchema.optional().describe("Optional older ROADtools commit SHA."),
        head_ref: shaSchema.optional().describe("Optional newer ROADtools commit SHA."),
        refresh: z.boolean().default(false).describe("Bypass cached history resolution."),
        app_id: guidSchema.optional().describe("Filter one exact application ID."),
        query: z.string().min(1).optional().describe("Partial application name or ID."),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe("Partial resource name, ID, or known API URI."),
        scope: z.string().min(1).optional().describe("Scope value to filter."),
        scope_match: z.enum(["exact", "contains"]).default("exact"),
        change: z.enum(["added", "removed", "all"]).default("all"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({
      base_ref,
      head_ref,
      refresh,
      app_id,
      query,
      resource,
      scope,
      scope_match,
      change,
      offset,
      limit,
    }) => {
      try {
        const history = await provider.getScopeHistory({
          ...(base_ref === undefined ? {} : { baseRef: base_ref }),
          ...(head_ref === undefined ? {} : { headRef: head_ref }),
          refresh,
        });
        return result(
          compareScopeHistory(history, {
            ...(app_id === undefined ? {} : { appId: app_id }),
            ...(query === undefined ? {} : { query }),
            ...(resource === undefined ? {} : { resource }),
            ...(scope === undefined ? {} : { scope }),
            scopeMatch: scope_match,
            change,
            offset,
            limit,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "search_entra_applications",
    {
      title: "Search Entra applications and scopes",
      description:
        "Search Microsoft first-party applications by app name/ID, published delegated scope, resource name/ID/API URI, reply URI, FOCI status, or public-client status. This is not tenant consent state.",
      inputSchema: z.object({
        query: z.string().min(1).optional().describe("Partial application name or app ID."),
        scope: z.string().min(1).optional().describe("OAuth scope name to match."),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe("Partial resource display name, resource app ID, or known API URI."),
        redirect_uri: z.string().min(1).optional().describe("Partial reply/redirect URI."),
        scope_match: z.enum(["exact", "contains"]).default("exact"),
        foci: z.boolean().optional().describe("Filter family-of-client-IDs applications."),
        public_client: z.boolean().optional().describe("Filter public client applications."),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ query, scope, resource, redirect_uri, scope_match, foci, public_client, offset, limit }) => {
      try {
        const snapshot = await provider.getSnapshot();
        return result(
          searchApplications(snapshot, {
            ...(query === undefined ? {} : { query }),
            ...(scope === undefined ? {} : { scope }),
            ...(resource === undefined ? {} : { resource }),
            ...(redirect_uri === undefined ? {} : { redirectUri: redirect_uri }),
            scopeMatch: scope_match,
            ...(foci === undefined ? {} : { foci }),
            ...(public_client === undefined ? {} : { publicClient: public_client }),
            offset,
            limit,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_entra_application",
    {
      title: "Get an Entra application",
      description:
        "Get paginated published scope metadata for one exact Microsoft first-party application ID, optionally filtered by resource name/ID/API URI and scope.",
      inputSchema: z.object({
        app_id: guidSchema.describe("Exact application (client) ID."),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe("Optional resource display name, resource app ID, or known API URI filter."),
        scope: z.string().min(1).optional().describe("Optional OAuth scope filter."),
        scope_match: z.enum(["exact", "contains"]).default("exact"),
        include_redirect_uris: z.boolean().default(false),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ app_id, resource, scope, scope_match, include_redirect_uris, offset, limit }) => {
      try {
        const snapshot = await provider.getSnapshot();
        const application = getApplication(
          snapshot,
          app_id,
          {
            ...(resource === undefined ? {} : { resource }),
            ...(scope === undefined ? {} : { scope }),
            scopeMatch: scope_match,
            includeRedirectUris: include_redirect_uris,
            offset,
            limit,
          },
        );
        if (!application) {
          return failure(`No application found for app ID ${app_id}.`);
        }
        return result(application);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_entrascopes_data_status",
    {
      title: "Get EntraScopes data status",
      description:
        "Report dataset provenance, refresh time, cache origin, and record counts. Set refresh to bypass the normal cache TTL.",
      inputSchema: z.object({
        refresh: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ refresh }) => {
      try {
        const snapshot = await provider.getSnapshot(refresh);
        return result(dataSummary(snapshot));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
