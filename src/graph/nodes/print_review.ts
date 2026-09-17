import type { GraphStateType } from "../state.js";

export interface PrintReviewDeps {
  print: (text: string) => void;
}

export function makePrintReviewNode(deps: PrintReviewDeps) {
  return async function print_review(state: GraphStateType): Promise<Partial<GraphStateType>> {
    deps.print(state.reviewText ?? "");
    return {};
  };
}
