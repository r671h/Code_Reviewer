import type { AnalyzeFile } from "../llm.js";
import { addedLineNumbers, hunkLineRanges, truncatePatch, truncateRelatedContext, type LineRange } from "../diff.js";
import { redactSecrets, type SecretMatch } from "../secrets.js";
import type { Issue } from "../../schemas/review.js";
import { mapWithConcurrency } from "../concurrency.js";
import type { FileContext, FileError, GraphStateType } from "../state.js";

export const DEFAULT_ANALYZE_CONCURRENCY = 4;

export interface AnalyzeDeps {
  analyzeFile: AnalyzeFile;
  /** Max LLM calls in flight at once. Rate limits (429) are absorbed by the call's own retry. */
  concurrency?: number;
}

interface FileAnalysis {
  issues: Issue[];
  fileErrors: FileError[];
}

/**
 * Runs the LLM analysis per file, up to `concurrency` files at a time;
 * results keep the input file order. A single file's analysis exhausting
 * retries doesn't abort the review — it's recorded as a fileError and the
 * review proceeds with whatever files succeeded.
 *
 * Model issues whose line falls outside every hunk of the file's diff are
 * dropped: the review covers what the PR changed, and a line the diff
 * doesn't touch is either hallucinated or out of scope.
 */
export function makeAnalyzeNode(deps: AnalyzeDeps) {
  const concurrency = deps.concurrency ?? DEFAULT_ANALYZE_CONCURRENCY;

  return async function analyze(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const perFile = await mapWithConcurrency(state.fileContexts, concurrency, (fileContext) =>
      analyzeOneFile(fileContext, deps.analyzeFile),
    );

    return {
      issues: perFile.flatMap((result) => result.issues),
      fileErrors: perFile.flatMap((result) => result.fileErrors),
    };
  };
}

async function analyzeOneFile(fileContext: FileContext, analyzeFile: AnalyzeFile): Promise<FileAnalysis> {
  const issues: Issue[] = [];
  // Scan the full patch (so a secret past the truncation point is still
  // caught), then truncate the redacted text; truncation is line-based, so
  // the order doesn't change what the LLM sees.
  const patchScan = redactSecrets(fileContext.patch);
  const contextScan = redactSecrets(fileContext.relatedContext);

  const added = secretsOnAddedLines(fileContext.patch, patchScan.matches);
  if (added.length > 0) {
    issues.push(secretIssue(fileContext.path, added));
  }

  try {
    const result = await analyzeFile({
      ...fileContext,
      patch: truncatePatch(patchScan.redacted),
      relatedContext: truncateRelatedContext(contextScan.redacted),
    });
    const ranges = hunkLineRanges(fileContext.patch);
    for (const issue of result.issues) {
      if (isWithin(issue.line, ranges)) {
        issues.push({ ...issue, file: fileContext.path });
      }
    }
    return { issues, fileErrors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { issues, fileErrors: [{ path: fileContext.path, stage: "analyze", message }] };
  }
}

function isWithin(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

const SECRET_KIND_LABELS: Record<SecretMatch["kind"], string> = {
  aws_access_key_id: "an AWS access key ID",
  private_key_block: "a private key block",
  keyword_adjacent_token: "a value that looks like a credential (api_key/secret/token/password)",
};

interface AddedSecret {
  kind: SecretMatch["kind"];
  /** 1-indexed line in the new file. */
  line: number;
}

/**
 * Keeps only matches on lines this PR adds. A secret on a context line
 * already existed before the PR, and one on a removed line is being taken
 * out — neither is something this change introduces. (Both are still
 * redacted before the LLM call.)
 */
function secretsOnAddedLines(patch: string, matches: SecretMatch[]): AddedSecret[] {
  const lineNumbers = addedLineNumbers(patch);
  return matches.flatMap((match) => {
    const line = lineNumbers.get(match.lineIndex);
    return line === undefined ? [] : [{ kind: match.kind, line }];
  });
}

/**
 * A deterministic, rule-based finding — not produced by (or dependent on)
 * the LLM, so it doesn't rely on the model noticing a `[REDACTED]`
 * placeholder. Never interpolates the matched value itself, only the kind.
 */
function secretIssue(path: string, secrets: AddedSecret[]): Issue {
  const kinds = [...new Set(secrets.map((s) => SECRET_KIND_LABELS[s.kind]))];
  const lines = [...new Set(secrets.map((s) => s.line))].sort((a, b) => a - b);
  return {
    file: path,
    line: lines[0] ?? 1,
    severity: "critical",
    category: "security",
    explanation:
      `Possible secret added by this PR (${kinds.join(", ")}) on line(s) ${lines.join(", ")}. ` +
      "The matched content was redacted before this file was sent to the LLM. " +
      "If this is a real credential, rotate it and remove it from the diff.",
  };
}
