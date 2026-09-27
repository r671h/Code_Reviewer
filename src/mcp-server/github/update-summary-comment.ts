import { IssueCommentSchema, type UpdateSummaryCommentInput } from "../../schemas/github.js";
import { GitHubNetworkError } from "../errors.js";
import { githubFetchJson } from "./github-fetch.js";
import type { PostedComment } from "./post-summary-comment.js";

/** Replaces the body of an existing issue/PR comment. */
export async function updateSummaryComment(input: UpdateSummaryCommentInput, token: string): Promise<PostedComment> {
  const [owner, name] = input.repo.split("/");
  const data = await githubFetchJson(
    `https://api.github.com/repos/${owner}/${name}/issues/comments/${input.comment_id}`,
    token,
    {
      method: "PATCH",
      body: { body: input.body },
      action: `updating comment ${input.comment_id} on ${input.repo}`,
      notFoundMessage: `Comment not found: ${input.repo} comment ${input.comment_id}`,
    },
  );

  const parsed = IssueCommentSchema.safeParse(data);
  if (!parsed.success) {
    throw new GitHubNetworkError(`Unexpected GitHub response updating comment ${input.comment_id} on ${input.repo}`);
  }
  return { id: parsed.data.id, htmlUrl: parsed.data.html_url };
}
