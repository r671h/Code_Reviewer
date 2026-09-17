import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGithubMcpServer } from "./server.js";

config();

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const server = createGithubMcpServer(githubToken);
const transport = new StdioServerTransport();
await server.connect(transport);
