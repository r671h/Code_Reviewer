// End-to-end demo of the review graph against a real PR. Streams and
// prints each node's output as it runs, so the intermediate state is
// visible, not just the final review text. Not part of the automated
// test suite — this makes real GitHub + Gemini API calls.
//
// Usage: npx tsx scripts/demo-review.ts <owner/repo> <pr_number>
import { config } from "dotenv";
import { getFileContent } from "../src/mcp-server/github/get-file-content.js";
import { getPrDiff } from "../src/mcp-server/github/get-pr-diff.js";
import { getRelatedContext } from "../src/mcp-server/github/get-related-context.js";
import { buildReviewGraph } from "../src/graph/graph.js";
import { createAnalyzeFile } from "../src/graph/llm.js";
import { makePrintReviewNode } from "../src/graph/nodes/print_review.js";

config();

const [, , repo, prNumberArg] = process.argv;
if (!repo || !prNumberArg) {
  throw new Error("Usage: npx tsx scripts/demo-review.ts <owner/repo> <pr_number>");
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) throw new Error("GITHUB_TOKEN environment variable is required");

const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) throw new Error("GEMINI_API_KEY environment variable is required");

const graph = buildReviewGraph({
  fetchDiff: { getPrDiff, githubToken },
  fetchContext: { getFileContent, getRelatedContext, githubToken },
  analyze: { analyzeFile: createAnalyzeFile(geminiApiKey) },
  deliverReview: makePrintReviewNode({ print: (text) => console.log(text) }),
});

const stream = await graph.stream(
  { repo, prNumber: Number(prNumberArg) },
  { streamMode: "updates" },
);

for await (const step of stream) {
  for (const [node, update] of Object.entries(step)) {
    console.log(`\n===== node: ${node} =====`);
    console.log(JSON.stringify(update, null, 2));
  }
}
