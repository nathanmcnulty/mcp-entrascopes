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
    { name: "mcp-entrascopes", version: "0.1.0" },
    {
      instructions:
        "Use this read-only server to inspect published Microsoft first-party application scope metadata. Results describe upstream metadata, not a tenant's service principals, grants, or proof of consent. Use get_entra_application for an exact app ID. Use search_entra_applications for app names, scope names, resource names, or IDs. Keep limits small and cite the returned provenance when the distinction matters.",
    },
  );

  server.registerTool(
    "search_entra_applications",
    {
      title: "Search Entra applications and scopes",
      description:
        "Search Microsoft first-party applications by app name/ID, published scope, resource name/ID, FOCI status, or public-client status. This is not tenant consent state.",
      inputSchema: z.object({
        query: z.string().min(1).optional().describe("Partial application name or app ID."),
        scope: z.string().min(1).optional().describe("OAuth scope name to match."),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe("Partial resource display name or resource app ID."),
        scope_match: z.enum(["exact", "contains"]).default("exact"),
        foci: z.boolean().optional().describe("Filter family-of-client-IDs applications."),
        public_client: z.boolean().optional().describe("Filter public client applications."),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ query, scope, resource, scope_match, foci, public_client, limit }) => {
      try {
        const snapshot = await provider.getSnapshot();
        return result(
          searchApplications(snapshot, {
            ...(query === undefined ? {} : { query }),
            ...(scope === undefined ? {} : { scope }),
            ...(resource === undefined ? {} : { resource }),
            scopeMatch: scope_match,
            ...(foci === undefined ? {} : { foci }),
            ...(public_client === undefined ? {} : { publicClient: public_client }),
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
        "Get published scope metadata for one exact Microsoft first-party application ID, optionally narrowed to a resource.",
      inputSchema: z.object({
        app_id: guidSchema.describe("Exact application (client) ID."),
        resource: z
          .string()
          .min(1)
          .optional()
          .describe("Optional resource display name or resource app ID filter."),
        include_redirect_uris: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ app_id, resource, include_redirect_uris }) => {
      try {
        const snapshot = await provider.getSnapshot();
        const application = getApplication(
          snapshot,
          app_id,
          resource,
          include_redirect_uris,
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
