import type { GetPrDiffInput } from "../../schemas/github.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError, GitHubRateLimitError } from "../errors.js";
import { isGitHubRateLimited } from "./classify-403.js";

export async function getPrDiff(input: GetPrDiffInput, token: string): Promise<string> {
  const [owner, name] = input.repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/pulls/${input.pr_number}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "codereviewer-mcp-server",
      },
    });
  } catch (cause) {
    throw new GitHubNetworkError(
      `Network error fetching PR diff for ${input.repo}#${input.pr_number}`,
      { cause },
    );
  }

  if (response.status === 401) {
    throw new GitHubAuthError(
      `GitHub auth failed fetching PR diff for ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }
  if (response.status === 403) {
    const bodyText = await response.text().catch(() => "");
    if (isGitHubRateLimited(response, bodyText)) {
      throw new GitHubRateLimitError(`GitHub rate limit hit fetching PR diff for ${input.repo}#${input.pr_number}`);
    }
    throw new GitHubAuthError(
      `GitHub auth failed fetching PR diff for ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError(`PR not found: ${input.repo}#${input.pr_number}`);
  }
  if (!response.ok) {
    throw new GitHubNetworkError(
      `GitHub API error fetching PR diff for ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }

  return response.text();
}
