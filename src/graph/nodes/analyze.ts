import type { AnalyzeFile } from "../llm.js";
import { hunkLineRanges, truncatePatch, truncateRelatedContext, type LineRange } from "../diff.js";
import { redactSecrets, type SecretMatch } from "../secrets.js";
import type { Issue } from "../../schemas/review.js";
import type { FileError, GraphStateType } from "../state.js";

export interface AnalyzeDeps {
  analyzeFile: AnalyzeFile;
}

/**
 * Runs the LLM analysis per file. A single file's analysis exhausting
 * retries doesn't abort the review — it's recorded as a fileError and the
 * review proceeds with whatever files succeeded.
 *
 * Model issues whose line falls outside every hunk of the file's diff are
 * dropped: the review covers what the PR changed, and a line the diff
 * doesn't touch is either hallucinated or out of scope.
 */
export function makeAnalyzeNode(deps: AnalyzeDeps) {
  return async function analyze(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const issues: Issue[] = [];
    const fileErrors: FileError[] = [];

    for (const fileContext of state.fileContexts) {
      const patchScan = redactSecrets(truncatePatch(fileContext.patch));
      const contextScan = redactSecrets(truncateRelatedContext(fileContext.relatedContext));
      const secretMatches = [...patchScan.matches, ...contextScan.matches];

      if (secretMatches.length > 0) {
        issues.push(secretIssue(fileContext.path, secretMatches));
      }

      try {
        const result = await deps.analyzeFile({
          ...fileContext,
          patch: patchScan.redacted,
          relatedContext: contextScan.redacted,
        });
        const ranges = hunkLineRanges(fileContext.patch);
        for (const issue of result.issues) {
          if (isWithin(issue.line, ranges)) {
            issues.push({ ...issue, file: fileContext.path });
          }
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

function isWithin(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

const SECRET_KIND_LABELS: Record<SecretMatch["kind"], string> = {
  aws_access_key_id: "an AWS access key ID",
  private_key_block: "a private key block",
  keyword_adjacent_token: "a value that looks like a credential (api_key/secret/token/password)",
};

/**
 * A deterministic, rule-based finding — not produced by (or dependent on)
 * the LLM, so it doesn't rely on the model noticing a `[REDACTED]`
 * placeholder. Never interpolates the matched value itself, only the kind.
 */
function secretIssue(path: string, matches: SecretMatch[]): Issue {
  const kinds = [...new Set(matches.map((m) => SECRET_KIND_LABELS[m.kind]))];
  return {
    file: path,
    line: 1,
    severity: "critical",
    category: "security",
    explanation:
      `Possible secret detected in this file's diff (${kinds.join(", ")}). ` +
      "The matched content was redacted before this file was sent to the LLM. " +
      "If this is a real credential, rotate it and remove it from the diff.",
  };
}
