import type { findSummaryComment } from "../../mcp-server/github/find-summary-comment.js";
import type { postSummaryComment } from "../../mcp-server/github/post-summary-comment.js";
import type { updateSummaryComment } from "../../mcp-server/github/update-summary-comment.js";
import { GitHubAuthError, GitHubNotFoundError } from "../../mcp-server/errors.js";
import type { GraphStateType } from "../state.js";

export interface PostReviewDeps {
  postSummaryComment: typeof postSummaryComment;
  findSummaryComment: typeof findSummaryComment;
  updateSummaryComment: typeof updateSummaryComment;
  githubToken: string;
}

/** Hidden in rendered Markdown; identifies this agent's review comment on a PR. */
export const REVIEW_MARKER = "<!-- codereviewer:summary -->";

/**
 * Posts the review as a PR comment — or, if an earlier run already left
 * one (found by {@link REVIEW_MARKER}), updates that comment in place, so
 * every push to the PR doesn't pile up another review.
 *
 * If the marked comment can't be edited (auth: someone else's comment
 * that happens to contain the marker; not_found: deleted in between), a
 * new comment is posted instead. Every other failure propagates rather
 * than being swallowed — a failed post means the review never reached the
 * PR, which the caller (CI run) should see as a failure.
 */
export function makePostReviewNode(deps: PostReviewDeps) {
  return async function post_review(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const body = `${state.reviewText ?? ""}\n\n${REVIEW_MARKER}`;
    const existing = await deps.findSummaryComment(
      { repo: state.repo, pr_number: state.prNumber, marker: REVIEW_MARKER },
      deps.githubToken,
    );

    if (existing) {
      try {
        await deps.updateSummaryComment({ repo: state.repo, comment_id: existing.id, body }, deps.githubToken);
        return {};
      } catch (error) {
        if (!(error instanceof GitHubAuthError || error instanceof GitHubNotFoundError)) throw error;
      }
    }

    await deps.postSummaryComment({ repo: state.repo, pr_number: state.prNumber, body }, deps.githubToken);
    return {};
  };
}
