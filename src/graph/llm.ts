import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AnalysisResultSchema, type AnalysisResult } from "../schemas/review.js";
import { withRetry, type RetryOptions } from "./retry.js";

export interface AnalyzeFileParams {
  path: string;
  patch: string;
  relatedContext: string;
}

export type AnalyzeFile = (params: AnalyzeFileParams) => Promise<AnalysisResult>;

const DEFAULT_MODEL = "gemini-3.6-flash";

/**
 * Builds the per-file analysis function used by the `analyze` node: one
 * Gemini call with Zod-schema-constrained structured output, wrapped with
 * retry (exponential backoff, max 3 attempts by default).
 */
export function createAnalyzeFile(
  apiKey: string,
  options: { model?: string; retry?: RetryOptions } = {},
): AnalyzeFile {
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: options.model ?? DEFAULT_MODEL,
    temperature: 0,
  });
  const structuredModel = model.withStructuredOutput(AnalysisResultSchema, { name: "report_issues" });

  return ({ path, patch, relatedContext }) =>
    withRetry(async () => {
      const result = await structuredModel.invoke(buildPrompt(path, patch, relatedContext));
      return AnalysisResultSchema.parse(result);
    }, { ...options.retry, retryDelayMs: options.retry?.retryDelayMs ?? extractGeminiRetryDelayMs });
}

interface GoogleApiErrorDetail {
  "@type"?: string;
  retryDelay?: string;
}

interface GoogleApiErrorShape {
  status?: number;
  errorDetails?: GoogleApiErrorDetail[];
}

/**
 * Extracts the server-suggested retry delay (ms) from a Gemini 429's
 * RetryInfo detail (`@google/generative-ai` surfaces it as
 * `error.errorDetails`, e.g. `{ "@type": ".../RetryInfo", retryDelay: "13s" }`),
 * so a rate-limited call waits as long as the server asked instead of
 * blindly exponential-backing off. Returns undefined for anything else.
 */
export function extractGeminiRetryDelayMs(error: unknown): number | undefined {
  if (!isGoogleApiErrorShape(error) || error.status !== 429) return undefined;

  const retryInfo = error.errorDetails?.find((detail) => detail["@type"]?.endsWith("RetryInfo"));
  const match = retryInfo?.retryDelay ? /^(\d+(?:\.\d+)?)s$/.exec(retryInfo.retryDelay) : null;
  return match?.[1] ? Number(match[1]) * 1000 : undefined;
}

function isGoogleApiErrorShape(error: unknown): error is GoogleApiErrorShape {
  return typeof error === "object" && error !== null && "status" in error;
}

function buildPrompt(path: string, patch: string, relatedContext: string): string {
  return [
    "You are a meticulous code reviewer analyzing a single changed file from a pull request.",
    "Find real bugs, security issues, style deviations, and N+1 query patterns introduced by this diff.",
    "Only report issues you are confident about. If nothing stands out, return an empty issues array — never invent a problem to seem thorough.",
    "Line numbers must refer to the new version of the file (the + side of the diff).",
    "",
    `File: ${path}`,
    "",
    "Diff (unified format, this file only):",
    "```diff",
    patch,
    "```",
    "",
    relatedContext.length > 0
      ? `Related context (imports used, sibling functions called by the changed code):\n${relatedContext}`
      : "No related context available.",
  ].join("\n");
}
