import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GetFileContentInputSchema,
  GetPrDiffInputSchema,
  GetRelatedContextInputSchema,
  PostSummaryCommentInputSchema,
} from "../schemas/github.js";
import { getFileContent } from "./github/get-file-content.js";
import { getPrDiff } from "./github/get-pr-diff.js";
import { getRelatedContext } from "./github/get-related-context.js";
import { postSummaryComment } from "./github/post-summary-comment.js";
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
