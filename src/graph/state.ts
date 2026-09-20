import { Annotation } from "@langchain/langgraph";
import type { ChangedFile } from "./diff.js";
import type { Issue } from "../schemas/review.js";

export interface FileContext {
  path: string;
  patch: string;
  /** Concatenated get_related_context output for symbols touched by the diff. Empty for non-TS files. */
  relatedContext: string;
}

export interface FileError {
  path: string;
  stage: "fetch_context" | "analyze" | "skipped";
  message: string;
}

export type Verdict = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

function overwrite<T>(): { reducer: (_prev: T, next: T) => T } {
  return { reducer: (_prev, next) => next };
}

/** Each node returns only the errors it found this run — this accumulates
 * them across nodes instead of the last writer replacing everyone else's. */
function append<T>(): { reducer: (prev: T[], next: T[]) => T[] } {
  return { reducer: (prev, next) => [...prev, ...next] };
}

export const GraphState = Annotation.Root({
  repo: Annotation<string>,
  prNumber: Annotation<number>,
  files: Annotation<ChangedFile[]>({ ...overwrite<ChangedFile[]>(), default: () => [] }),
  fileContexts: Annotation<FileContext[]>({ ...overwrite<FileContext[]>(), default: () => [] }),
  issues: Annotation<Issue[]>({ ...overwrite<Issue[]>(), default: () => [] }),
  fileErrors: Annotation<FileError[]>({ ...append<FileError>(), default: () => [] }),
  verdict: Annotation<Verdict | undefined>({ ...overwrite<Verdict | undefined>(), default: () => undefined }),
  reviewText: Annotation<string | undefined>({
    ...overwrite<string | undefined>(),
    default: () => undefined,
  }),
});

export type GraphStateType = typeof GraphState.State;
