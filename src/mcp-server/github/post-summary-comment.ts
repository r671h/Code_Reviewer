import type { PostSummaryCommentInput } from "../../schemas/github.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError, GitHubRateLimitError } from "../errors.js";
import { isGitHubRateLimited } from "./classify-403.js";

export interface PostedComment {
  id: number;
  htmlUrl: string;
}

/**
 * Posts one summary comment on a PR via the issue-comments endpoint (PRs
 * are issues for commenting purposes). Deliberately not the "create a
 * review" endpoint with per-line positioned comments — that needs mapping
 * issue line numbers to the diff's position field, which is unresolved
 * (see PLAN.md's open questions). One well-formatted comment matches the
 * single `reviewText` the graph already produces.
 */
export async function postSummaryComment(input: PostSummaryCommentInput, token: string): Promise<PostedComment> {
  const [owner, name] = input.repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/issues/${input.pr_number}/comments`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "codereviewer-mcp-server",
      },
      body: JSON.stringify({ body: input.body }),
    });
  } catch (cause) {
    throw new GitHubNetworkError(
      `Network error posting summary comment on ${input.repo}#${input.pr_number}`,
      { cause },
    );
  }

  if (response.status === 401) {
    throw new GitHubAuthError(
      `GitHub auth failed posting comment on ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }
  if (response.status === 403) {
    const bodyText = await response.text().catch(() => "");
    if (isGitHubRateLimited(response, bodyText)) {
      throw new GitHubRateLimitError(`GitHub rate limit hit posting comment on ${input.repo}#${input.pr_number}`);
    }
    throw new GitHubAuthError(
      `GitHub auth failed posting comment on ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError(`PR not found: ${input.repo}#${input.pr_number}`);
  }
  if (!response.ok) {
    throw new GitHubNetworkError(
      `GitHub API error posting comment on ${input.repo}#${input.pr_number} (status ${response.status})`,
    );
  }

  const data = (await response.json()) as { id: number; html_url: string };
  return { id: data.id, htmlUrl: data.html_url };
}
