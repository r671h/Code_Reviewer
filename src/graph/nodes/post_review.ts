import type { postSummaryComment } from "../../mcp-server/github/post-summary-comment.js";
import type { GraphStateType } from "../state.js";

export interface PostReviewDeps {
  postSummaryComment: typeof postSummaryComment;
  githubToken: string;
}

/**
 * Posts the review as a real PR comment. Failure propagates rather than
 * being swallowed — unlike a single file's analysis, a failed post means
 * the whole review never reached the PR, which the caller (CI run) should
 * see as a failure, not a silently empty success.
 */
export function makePostReviewNode(deps: PostReviewDeps) {
  return async function post_review(state: GraphStateType): Promise<Partial<GraphStateType>> {
    await deps.postSummaryComment(
      { repo: state.repo, pr_number: state.prNumber, body: state.reviewText ?? "" },
      deps.githubToken,
    );
    return {};
  };
}
