export interface ChangedFile {
  path: string;
  /** This file's hunk text, starting at the first `@@` line. */
  patch: string;
  /** 1-indexed line numbers in the new version of the file that were added or modified. */
  changedLines: number[];
}

export const MAX_PATCH_LINES = 500;

/**
 * Caps a single file's patch at `maxLines`, so one unusually large file
 * never sends an unbounded prompt to the LLM. Per-file LLM calls already
 * keep a whole large PR bounded (no call ever sees more than one file's
 * patch) — this covers the case of one file itself having a 500+ line
 * diff.
 */
export function truncatePatch(patch: string, maxLines: number = MAX_PATCH_LINES): string {
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;

  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... (diff truncated at ${maxLines} lines, ${omitted} more line(s) omitted)`].join(
    "\n",
  );
}

export const MAX_RELATED_CONTEXT_CHARS = 8000;

/**
 * Caps the aggregated related-context text (one file's changed symbols,
 * concatenated) at `maxChars`. `get_related_context` already budgets each
 * individual symbol's output, but a file with many changed symbols has no
 * limit on the sum — this bounds the worst case so the prompt sent to the
 * LLM stays predictable regardless of how many symbols changed.
 */
export function truncateRelatedContext(text: string, maxChars: number = MAX_RELATED_CONTEXT_CHARS): string {
  if (text.length <= maxChars) return text;

  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n... (related context truncated at ${maxChars} characters, ${omitted} more character(s) omitted)`;
}

const FILE_HEADER = /^diff --git a\/.* b\/(.*)$/;
const NEW_FILE_PATH = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Splits a unified diff (as returned by `get_pr_diff`) into one entry per
 * changed file, with the 1-indexed line numbers (in the new file) that were
 * added or modified. Deleted files are excluded — there's no new-file
 * content to analyze.
 */
export function parseUnifiedDiff(diffText: string): ChangedFile[] {
  if (diffText.trim().length === 0) return [];

  const files: ChangedFile[] = [];
  const lines = diffText.split("\n");

  let currentPath: string | undefined;
  let currentPatchLines: string[] = [];
  let currentChangedLines: number[] = [];
  let newFileHeaderSeen = false;
  let isDeleted = false;
  let newLineCursor = 0;
  let inHunk = false;

  const flush = () => {
    if (currentPath && !isDeleted) {
      files.push({ path: currentPath, patch: currentPatchLines.join("\n"), changedLines: currentChangedLines });
    }
    currentPath = undefined;
    currentPatchLines = [];
    currentChangedLines = [];
    newFileHeaderSeen = false;
    isDeleted = false;
    inHunk = false;
  };

  for (const line of lines) {
    const fileHeaderMatch = FILE_HEADER.exec(line);
    if (fileHeaderMatch) {
      flush();
      currentPath = fileHeaderMatch[1];
      continue;
    }

    if (currentPath === undefined) continue;

    if (!newFileHeaderSeen) {
      const newFileMatch = NEW_FILE_PATH.exec(line);
      if (newFileMatch) {
        newFileHeaderSeen = true;
        isDeleted = newFileMatch[1] === undefined;
      }
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      inHunk = true;
      newLineCursor = Number(hunkMatch[1]);
      currentPatchLines.push(line);
      continue;
    }

    if (!inHunk) continue;

    currentPatchLines.push(line);

    if (line.startsWith("+")) {
      currentChangedLines.push(newLineCursor);
      newLineCursor += 1;
    } else if (line.startsWith(" ")) {
      newLineCursor += 1;
    }
    // Lines starting with "-" are removed from the old file; they don't
    // advance the new-file line cursor and aren't a "changed line" in it.
  }

  flush();

  return files;
}
