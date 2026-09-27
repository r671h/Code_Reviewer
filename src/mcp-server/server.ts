import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GetFileContentInputSchema,
  GetPrDiffInputSchema,
  GetPrHeadShaInputSchema,
  GetRelatedContextInputSchema,
  PostSummaryCommentInputSchema,
  FindSummaryCommentInputSchema,
  UpdateSummaryCommentInputSchema,
} from "../schemas/github.js";
import { getFileContent } from "./github/get-file-content.js";
import { getPrDiff } from "./github/get-pr-diff.js";
import { getPrHeadSha } from "./github/get-pr-head-sha.js";
import { getRelatedContext } from "./github/get-related-context.js";
import { postSummaryComment } from "./github/post-summary-comment.js";
import { findSummaryComment } from "./github/find-summary-comment.js";
import { updateSummaryComment } from "./github/update-summary-comment.js";
import type { GitHubMcpError } from "./errors.js";

export function createGithubMcpServer(githubToken: string): McpServer {
  const server = new McpServer({ name: "github-mcp-server", version: "0.1.0" });

  server.registerTool(
    "get_pr_diff",
    {
      title: "Get PR diff",
      description: "Fetches the unified diff for a GitHub pull request.",
      inputSchema: GetPrDiffInputSchema.shape,
    },
    (input) => toToolResult(() => getPrDiff(input, githubToken)),
  );

  server.registerTool(
    "get_pr_head_sha",
    {
      title: "Get PR head SHA",
      description: "Returns the SHA of a pull request's head commit (the ref to read changed files at).",
      inputSchema: GetPrHeadShaInputSchema.shape,
    },
    (input) => toToolResult(() => getPrHeadSha(input, githubToken)),
  );

  server.registerTool(
    "get_file_content",
    {
      title: "Get file content",
      description: "Fetches the raw content of a file from a GitHub repo at a given ref.",
      inputSchema: GetFileContentInputSchema.shape,
    },
    (input) => toToolResult(() => getFileContent(input, githubToken)),
  );

  server.registerTool(
    "get_related_context",
    {
      title: "Get related context",
      description:
        "One-hop AST-derived context for a symbol: signatures of same-file sibling " +
        "functions it calls, plus signatures of the repo-local imports it uses " +
        "(external packages noted by name only). Capped at ~2000 tokens.",
      inputSchema: GetRelatedContextInputSchema.shape,
    },
    (input) => toToolResult(() => getRelatedContext(input, githubToken)),
  );

  server.registerTool(
    "post_summary_comment",
    {
      title: "Post summary comment",
      description: "Posts one summary comment (Markdown body) on a GitHub pull request.",
      inputSchema: PostSummaryCommentInputSchema.shape,
    },
    (input) =>
      toToolResult(async () => {
        const posted = await postSummaryComment(input, githubToken);
        return `Posted comment: ${posted.htmlUrl}`;
      }),
  );

  server.registerTool(
    "find_summary_comment",
    {
      title: "Find summary comment",
      description:
        "Finds the most recent comment on a pull request whose body contains a marker string. " +
        "Returns its id and URL, or reports that none exists.",
      inputSchema: FindSummaryCommentInputSchema.shape,
    },
    (input) =>
      toToolResult(async () => {
        const found = await findSummaryComment(input, githubToken);
        return found ? `Found comment ${found.id}: ${found.htmlUrl}` : "No matching comment found";
      }),
  );

  server.registerTool(
    "update_summary_comment",
    {
      title: "Update summary comment",
      description: "Replaces the Markdown body of an existing comment on a GitHub pull request.",
      inputSchema: UpdateSummaryCommentInputSchema.shape,
    },
    (input) =>
      toToolResult(async () => {
        const updated = await updateSummaryComment(input, githubToken);
        return `Updated comment: ${updated.htmlUrl}`;
      }),
  );

  return server;
}

async function toToolResult(work: () => Promise<string>): Promise<CallToolResult> {
  try {
    const text = await work();
    return { content: [{ type: "text", text }] };
  } catch (error) {
    const message = isGitHubMcpError(error) ? `[${error.category}] ${error.message}` : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function isGitHubMcpError(error: unknown): error is GitHubMcpError {
  return error instanceof Error && "category" in error;
}
