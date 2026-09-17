// Manual verification script: calls get_related_context through the
// real MCP protocol (Client <-> Server over an in-memory transport)
// against a live GitHub repo. Not part of the automated test suite.
//
// Usage: npx tsx scripts/demo-get-related-context.ts <owner/repo> <path> <symbol>
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGithubMcpServer } from "../src/mcp-server/server.js";

config();

const [, , repo, path, symbol] = process.argv;
if (!repo || !path || !symbol) {
  throw new Error("Usage: npx tsx scripts/demo-get-related-context.ts <owner/repo> <path> <symbol>");
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
  name: "get_related_context",
  arguments: { repo, path, symbol },
});

console.log(JSON.stringify(result, null, 2));

await client.close();
await server.close();
