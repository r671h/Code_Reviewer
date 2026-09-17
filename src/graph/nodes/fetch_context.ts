import type { getFileContent } from "../../mcp-server/github/get-file-content.js";
import type { getRelatedContext } from "../../mcp-server/github/get-related-context.js";
import { findChangedSymbols } from "../../mcp-server/github/related-context-ast.js";
import type { ChangedFile } from "../diff.js";
import type { FileContext, FileError, GraphStateType } from "../state.js";

export interface FetchContextDeps {
  getFileContent: typeof getFileContent;
  getRelatedContext: typeof getRelatedContext;
  githubToken: string;
}

const TS_FILE = /\.tsx?$/;

export function makeFetchContextNode(deps: FetchContextDeps) {
  return async function fetch_context(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const fileContexts: FileContext[] = [];
    const fileErrors: FileError[] = [];

    for (const file of state.files) {
      const { context, errors } = await buildFileContext(state.repo, file, deps);
      fileContexts.push(context);
      fileErrors.push(...errors);
    }

    return { fileContexts, fileErrors };
  };
}

async function buildFileContext(
  repo: string,
  file: ChangedFile,
  deps: FetchContextDeps,
): Promise<{ context: FileContext; errors: FileError[] }> {
  if (!TS_FILE.test(file.path)) {
    return { context: { path: file.path, patch: file.patch, relatedContext: "" }, errors: [] };
  }

  let sourceText: string;
  try {
    sourceText = await deps.getFileContent({ repo, path: file.path }, deps.githubToken);
  } catch (error) {
    return {
      context: { path: file.path, patch: file.patch, relatedContext: "" },
      errors: [{ path: file.path, stage: "fetch_context", message: messageOf(error) }],
    };
  }

  const symbols = findChangedSymbols(sourceText, file.changedLines, file.path);
  const errors: FileError[] = [];
  const contextTexts: string[] = [];

  for (const symbol of symbols) {
    try {
      const text = await deps.getRelatedContext({ repo, path: file.path, symbol }, deps.githubToken);
      contextTexts.push(text);
    } catch (error) {
      errors.push({ path: file.path, stage: "fetch_context", message: messageOf(error) });
    }
  }

  return {
    context: { path: file.path, patch: file.patch, relatedContext: contextTexts.join("\n\n") },
    errors,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
