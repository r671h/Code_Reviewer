import type { GraphStateType, Verdict } from "../state.js";

export function decide_verdict(state: GraphStateType): Partial<GraphStateType> {
  return { verdict: computeVerdict(state) };
}

function computeVerdict(state: GraphStateType): Verdict {
  if (state.issues.some((issue) => issue.severity === "critical")) return "REQUEST_CHANGES";
  if (state.issues.length > 0) return "COMMENT";
  return "APPROVE";
}
