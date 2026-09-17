import type { getPrDiff } from "../../mcp-server/github/get-pr-diff.js";
import { parseUnifiedDiff } from "../diff.js";
import type { GraphStateType } from "../state.js";

export interface FetchDiffDeps {
  getPrDiff: typeof getPrDiff;
  githubToken: string;
}

export function makeFetchDiffNode(deps: FetchDiffDeps) {
  return async function fetch_diff(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const diffText = await deps.getPrDiff({ repo: state.repo, pr_number: state.prNumber }, deps.githubToken);
    return { files: parseUnifiedDiff(diffText) };
  };
}
