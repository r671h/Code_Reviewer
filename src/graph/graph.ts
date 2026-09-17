import { END, START, StateGraph } from "@langchain/langgraph";
import { GraphState, type GraphStateType } from "./state.js";
import { makeFetchDiffNode, type FetchDiffDeps } from "./nodes/fetch_diff.js";
import { makeFetchContextNode, type FetchContextDeps } from "./nodes/fetch_context.js";
import { makeAnalyzeNode, type AnalyzeDeps } from "./nodes/analyze.js";
import { decide_verdict } from "./nodes/decide_verdict.js";
import { format_review } from "./nodes/format_review.js";
import { format_no_issues } from "./nodes/format_no_issues.js";

export type DeliverReviewNode = (state: GraphStateType) => Promise<Partial<GraphStateType>>;

export interface BuildReviewGraphDeps {
  fetchDiff: FetchDiffDeps;
  fetchContext: FetchContextDeps;
  analyze: AnalyzeDeps;
  /**
   * The terminal node: what to do with the finished review. Pass
   * `makePrintReviewNode(...)` to just log it, or `makePostReviewNode(...)`
   * to post it as a real PR comment — the graph doesn't care which.
   */
  deliverReview: DeliverReviewNode;
}

/**
 * Assembles the review graph:
 *
 *   fetch_diff -> fetch_context -> analyze -> decide_verdict
 *     -[has issues]-> format_review   -\
 *     -[no issues] -> format_no_issues -> deliver_review -> END
 *
 * fetch_context and analyze each iterate their file list internally rather
 * than fanning out via LangGraph's Send API — see PLAN.md's "diff
 * processing strategy" note for why (still per-file LLM calls, still
 * resilient to a single file's failure; true node-level fan-out remains a
 * valid future upgrade for parallelism).
 */
export function buildReviewGraph(deps: BuildReviewGraphDeps) {
  return new StateGraph(GraphState)
    .addNode("fetch_diff", makeFetchDiffNode(deps.fetchDiff))
    .addNode("fetch_context", makeFetchContextNode(deps.fetchContext))
    .addNode("analyze", makeAnalyzeNode(deps.analyze))
    .addNode("decide_verdict", decide_verdict)
    .addNode("format_review", format_review)
    .addNode("format_no_issues", format_no_issues)
    .addNode("deliver_review", deps.deliverReview)
    .addEdge(START, "fetch_diff")
    .addEdge("fetch_diff", "fetch_context")
    .addEdge("fetch_context", "analyze")
    .addEdge("analyze", "decide_verdict")
    .addConditionalEdges("decide_verdict", routeByIssues, ["format_review", "format_no_issues"])
    .addEdge("format_review", "deliver_review")
    .addEdge("format_no_issues", "deliver_review")
    .addEdge("deliver_review", END)
    .compile();
}

function routeByIssues(state: GraphStateType): "format_review" | "format_no_issues" {
  return state.issues.length > 0 ? "format_review" : "format_no_issues";
}
