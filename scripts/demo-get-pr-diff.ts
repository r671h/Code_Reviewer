// Manual verification script: calls get_pr_diff through the real MCP
// protocol (Client <-> Server over an in-memory transport) against a
// live GitHub PR. Not part of the automated test suite.
//
// Usage: npx tsx scripts/demo-get-pr-diff.ts <owner/repo> <pr_number>
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGithubMcpServer } from "../src/mcp-server/server.js";

config();

const [, , repo, prNumberArg] = process.argv;
if (!repo || !prNumberArg) {
  throw new Error("Usage: npx tsx scripts/demo-get-pr-diff.ts <owner/repo> <pr_number>");
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const server = createGithubMcpServer(githubToken);
const client = new Client({ name: "demo-client", version: "0.1.0" });

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const result = await client.callTool({
  name: "get_pr_diff",
  arguments: { repo, pr_number: Number(prNumberArg) },
});

console.log(JSON.stringify(result, null, 2));

await client.close();
await server.close();
