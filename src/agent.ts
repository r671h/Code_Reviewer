// CLI entry point: assembles the graph and runs it against a repo/PR.
//
// Usage: npx tsx src/agent.ts <owner/repo> <pr_number> [--post]
//
// Without --post, the review is printed to the console (safe default for
// local runs). With --post, it's posted as a real comment on the PR — this
// is what the GitHub Action (action.yml) uses.
import { config } from "dotenv";
import { getFileContent } from "./mcp-server/github/get-file-content.js";
import { getPrDiff } from "./mcp-server/github/get-pr-diff.js";
import { getRelatedContext } from "./mcp-server/github/get-related-context.js";
import { postSummaryComment } from "./mcp-server/github/post-summary-comment.js";
import { buildReviewGraph } from "./graph/graph.js";
import { createAnalyzeFile } from "./graph/llm.js";
import { makePrintReviewNode } from "./graph/nodes/print_review.js";
import { makePostReviewNode } from "./graph/nodes/post_review.js";

config();

const args = process.argv.slice(2);
const post = args.includes("--post");
const [repo, prNumberArg] = args.filter((arg) => !arg.startsWith("--"));

if (!repo || !prNumberArg) {
  console.error("Usage: agent <owner/repo> <pr_number> [--post]");
  process.exit(1);
}

const githubToken = requireEnv("GITHUB_TOKEN");
const geminiApiKey = requireEnv("GEMINI_API_KEY");

const graph = buildReviewGraph({
  fetchDiff: { getPrDiff, githubToken },
  fetchContext: { getFileContent, getRelatedContext, githubToken },
  analyze: { analyzeFile: createAnalyzeFile(geminiApiKey) },
  deliverReview: post
    ? makePostReviewNode({ postSummaryComment, githubToken })
    : makePrintReviewNode({ print: (text) => console.log(text) }),
});

await graph.invoke({ repo, prNumber: Number(prNumberArg) });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}
