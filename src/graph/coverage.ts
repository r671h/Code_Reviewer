import type { FileError } from "./state.js";

/**
 * Paths of changed files the LLM never analyzed: analysis failed, or the
 * file was skipped over max_files. A fetch_context failure doesn't count —
 * that file is still analyzed on its diff alone.
 */
export function unanalyzedPaths(fileErrors: FileError[]): Set<string> {
  return new Set(
    fileErrors.filter((error) => error.stage === "analyze" || error.stage === "skipped").map((error) => error.path),
  );
}
