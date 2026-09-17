import type { AnalyzeFile } from "../llm.js";
import { truncatePatch } from "../diff.js";
import type { Issue } from "../../schemas/review.js";
import type { FileError, GraphStateType } from "../state.js";

export interface AnalyzeDeps {
  analyzeFile: AnalyzeFile;
}

/**
 * Runs the LLM analysis per file. A single file's analysis exhausting
 * retries doesn't abort the review — it's recorded as a fileError and the
 * review proceeds with whatever files succeeded.
 */
export function makeAnalyzeNode(deps: AnalyzeDeps) {
  return async function analyze(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const issues: Issue[] = [];
    const fileErrors: FileError[] = [];

    for (const fileContext of state.fileContexts) {
      try {
        const result = await deps.analyzeFile({ ...fileContext, patch: truncatePatch(fileContext.patch) });
        for (const issue of result.issues) {
          issues.push({ ...issue, file: fileContext.path });
        }
      } catch (error) {
        fileErrors.push({
          path: fileContext.path,
          stage: "analyze",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { issues, fileErrors };
  };
}
