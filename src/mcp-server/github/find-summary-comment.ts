import { IssueCommentListSchema, type FindSummaryCommentInput } from "../../schemas/github.js";
import { GitHubNetworkError } from "../errors.js";
import { githubFetchJson } from "./github-fetch.js";
import type { PostedComment } from "./post-summary-comment.js";

const PER_PAGE = 100;

/**
 * Finds the most recent issue comment on a PR whose body contains
 * `marker`, paging through all of the PR's comments. Returns undefined
 * when none matches. Lets a re-run update its earlier review instead of
 * posting a duplicate.
 */
export async function findSummaryComment(
  input: FindSummaryCommentInput,
  token: string,
): Promise<PostedComment | undefined> {
  const [owner, name] = input.repo.split("/");
  let latest: PostedComment | undefined;

  for (let page = 1; ; page += 1) {
    const data = await githubFetchJson(
      `https://api.github.com/repos/${owner}/${name}/issues/${input.pr_number}/comments?per_page=${PER_PAGE}&page=${page}`,
      token,
      {
        action: `listing comments on ${input.repo}#${input.pr_number}`,
        notFoundMessage: `PR not found: ${input.repo}#${input.pr_number}`,
      },
    );

    const parsed = IssueCommentListSchema.safeParse(data);
    if (!parsed.success) {
      throw new GitHubNetworkError(`Unexpected GitHub response listing comments on ${input.repo}#${input.pr_number}`);
    }

    for (const comment of parsed.data) {
      if (comment.body?.includes(input.marker)) {
        latest = { id: comment.id, htmlUrl: comment.html_url };
      }
    }

    if (parsed.data.length < PER_PAGE) return latest;
  }
}
