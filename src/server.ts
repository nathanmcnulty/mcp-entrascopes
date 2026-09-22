import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { EntraScopesDataProvider } from "./data.js";
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
  provider: Pick<EntraScopesDataProvider, "getSnapshot"> = new EntraScopesDataProvider(),
): McpServer {
  const server = new McpServer(
    { name: "mcp-entrascopes", version: "0.2.0" },
    {
      instructions:
        "Use this read-only server to inspect published Microsoft first-party application scope metadata. Results describe upstream delegated-scope metadata, not app roles, tenant grants, or proof of consent. Use get_entra_application for an exact app ID and page large results. Use search_entra_applications for app names, scopes, resource names, IDs, or known API URIs. Cite returned provenance when the distinction matters.",
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
