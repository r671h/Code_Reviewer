import posixPath from "node:path/posix";
import type { GetRelatedContextInput } from "../../schemas/github.js";
import { GitHubNotFoundError } from "../errors.js";
import { getFileContent } from "./get-file-content.js";
import { analyzeSymbol, extractSignature, type FunctionSignature, type ImportUsage } from "./related-context-ast.js";

const DEFAULT_TOKEN_BUDGET = 2000;

interface RenderedItem {
  /** Lower renders first when the output is truncated to fit the token budget. */
  tier: number;
  text: string;
}

/**
 * One-hop, AST-based related context for `symbol` in `path`: signatures
 * of same-file sibling functions it calls, plus signatures of the
 * repo-local imports it uses (resolved one hop, not transitively).
 * External package imports are noted by name only.
 */
export async function getRelatedContext(
  input: GetRelatedContextInput,
  token: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
): Promise<string> {
  const sourceText = await getFileContent({ repo: input.repo, path: input.path }, token);
  const analysis = analyzeSymbol(sourceText, input.symbol, input.path);

  const items: RenderedItem[] = analysis.calledSiblings.map((sig) => ({
    tier: 0,
    text: formatSignatureLine(sig),
  }));

  const importItems = await Promise.all(
    analysis.usedImports.map((imp) => resolveImport(input, imp, token)),
  );
  items.push(...importItems);

  return formatContext(input.symbol, items, tokenBudget);
}

async function resolveImport(
  input: GetRelatedContextInput,
  imp: ImportUsage,
  token: string,
): Promise<RenderedItem> {
  if (!imp.isLocal) {
    return { tier: 4, text: `- \`${imp.name}\` — external package \`"${imp.modulePath}"\` (not resolved)` };
  }

  if (!imp.exportedName) {
    return {
      tier: 3,
      text: `- \`${imp.name}\` — namespace import from \`"${imp.modulePath}"\` (not resolved to a single symbol)`,
    };
  }

  const base = resolveModuleBase(input.path, imp.modulePath);
  const found = await fetchFirstExisting(input.repo, candidatePaths(base), token);
  if (!found) {
    return { tier: 3, text: `- \`${imp.name}\` — local import \`"${imp.modulePath}"\` (could not resolve file)` };
  }

  const signature = extractSignature(found.content, imp.exportedName, found.path);
  if (!signature) {
    return {
      tier: 3,
      text: `- \`${imp.name}\` — resolved to \`${found.path}\` but export \`${imp.exportedName}\` not found`,
    };
  }

  return { tier: imp.calledDirectly ? 1 : 2, text: formatSignatureLine(signature, found.path) };
}

function resolveModuleBase(fromPath: string, specifier: string): string {
  const dir = posixPath.dirname(fromPath);
  return posixPath.normalize(posixPath.join(dir, specifier));
}

function candidatePaths(base: string): string[] {
  if (/\.(ts|tsx)$/.test(base)) return [base];
  return [`${base}.ts`, `${base}.tsx`, posixPath.join(base, "index.ts"), posixPath.join(base, "index.tsx")];
}

async function fetchFirstExisting(
  repo: string,
  candidates: string[],
  token: string,
): Promise<{ path: string; content: string } | undefined> {
  for (const candidate of candidates) {
    try {
      const content = await getFileContent({ repo, path: candidate }, token);
      return { path: candidate, content };
    } catch (error) {
      if (error instanceof GitHubNotFoundError) continue;
      throw error;
    }
  }
  return undefined;
}

function formatSignatureLine(signature: FunctionSignature, sourcePath?: string): string {
  const location = sourcePath ? ` (from ${sourcePath})` : "";
  const doc = signature.jsDoc ? `\n  ${signature.jsDoc.replace(/\n/g, "\n  ")}` : "";
  return `- \`${signature.signature}\`${location}${doc}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatContext(symbol: string, items: RenderedItem[], tokenBudget: number): string {
  const sorted = [...items].sort((a, b) => a.tier - b.tier);
  const header = `Related context for \`${symbol}\`:\n`;

  let body = "";
  let omitted = 0;
  for (const item of sorted) {
    const candidate = `${body}${item.text}\n`;
    if (estimateTokens(header + candidate) > tokenBudget) {
      omitted += 1;
      continue;
    }
    body = candidate;
  }

  if (body.length === 0 && omitted === 0) {
    return `${header}(no related imports or sibling calls found)`;
  }

  const footer =
    omitted > 0 ? `\n(...truncated, ${omitted} more item(s) omitted to stay under ~${tokenBudget} tokens)` : "";
  return `${header}${body}${footer}`;
}
