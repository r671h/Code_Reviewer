import type { getPrDiff } from "../../mcp-server/github/get-pr-diff.js";
import { parseUnifiedDiff, type ChangedFile } from "../diff.js";
import type { FileError, GraphStateType } from "../state.js";

export const DEFAULT_MAX_FILES = 30;

export interface FetchDiffDeps {
  getPrDiff: typeof getPrDiff;
  githubToken: string;
  /** Files beyond this count are not analyzed — recorded as skipped fileErrors instead. */
  maxFiles?: number;
}

export function makeFetchDiffNode(deps: FetchDiffDeps) {
  const maxFiles = deps.maxFiles ?? DEFAULT_MAX_FILES;

  return async function fetch_diff(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const diffText = await deps.getPrDiff({ repo: state.repo, pr_number: state.prNumber }, deps.githubToken);
    const allFiles = parseUnifiedDiff(diffText);
    return limitFiles(allFiles, maxFiles);
  };
}

function limitFiles(files: ChangedFile[], maxFiles: number): { files: ChangedFile[]; fileErrors: FileError[] } {
  if (files.length <= maxFiles) return { files, fileErrors: [] };

  const kept = files.slice(0, maxFiles);
  const skipped = files.slice(maxFiles);
  const fileErrors: FileError[] = skipped.map((file) => ({
    path: file.path,
    stage: "skipped",
    message: `PR has ${files.length} changed files, exceeding max_files=${maxFiles}; this file was not analyzed`,
  }));

  return { files: kept, fileErrors };
}
