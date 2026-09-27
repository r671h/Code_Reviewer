import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError, GitHubRateLimitError } from "../errors.js";
import { isGitHubRateLimited } from "./classify-403.js";

export interface GitHubFetchOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Human-readable action for error messages, e.g. "fetching PR octocat/hello-world#42". */
  action: string;
  /** Message for the GitHubNotFoundError thrown on a 404. */
  notFoundMessage: string;
}

/**
 * Performs a JSON request against the GitHub REST API and maps every
 * failure to a typed MCP error (network / auth / rate_limit / not_found).
 * Returns the parsed JSON body as `unknown` — callers validate it with a
 * Zod schema rather than casting.
 */
export async function githubFetchJson(url: string, token: string, options: GitHubFetchOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "codereviewer-mcp-server",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (cause) {
    throw new GitHubNetworkError(`Network error ${options.action}`, { cause });
  }

  if (response.status === 401) {
    throw new GitHubAuthError(`GitHub auth failed ${options.action} (status ${response.status})`);
  }
  if (response.status === 403) {
    const bodyText = await response.text().catch(() => "");
    if (isGitHubRateLimited(response, bodyText)) {
      throw new GitHubRateLimitError(`GitHub rate limit hit ${options.action}`);
    }
    throw new GitHubAuthError(`GitHub auth failed ${options.action} (status ${response.status})`);
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError(options.notFoundMessage);
  }
  if (!response.ok) {
    throw new GitHubNetworkError(`GitHub API error ${options.action} (status ${response.status})`);
  }

  return response.json();
}
