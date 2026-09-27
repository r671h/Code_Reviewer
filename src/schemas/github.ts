import { z } from "zod";

export const GetPrDiffInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  pr_number: z.number().int().positive(),
});

export type GetPrDiffInput = z.infer<typeof GetPrDiffInputSchema>;

export const GetPrHeadShaInputSchema = GetPrDiffInputSchema;

export type GetPrHeadShaInput = z.infer<typeof GetPrHeadShaInputSchema>;

/** The slice of GitHub's pull-request JSON that get_pr_head_sha reads. */
export const PullRequestHeadSchema = z.object({
  head: z.object({ sha: z.string().min(1) }),
});

export const GetFileContentInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  path: z.string().min(1),
  ref: z.string().min(1).optional(),
});

export type GetFileContentInput = z.infer<typeof GetFileContentInputSchema>;

export const GetRelatedContextInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  path: z.string().min(1),
  symbol: z.string().min(1),
  /** Commit/branch to read `path` and its imports at; defaults to the repo's default branch. */
  ref: z.string().min(1).optional(),
});

export type GetRelatedContextInput = z.infer<typeof GetRelatedContextInputSchema>;

export const PostSummaryCommentInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  pr_number: z.number().int().positive(),
  body: z.string().min(1),
});

export type PostSummaryCommentInput = z.infer<typeof PostSummaryCommentInputSchema>;

export const FindSummaryCommentInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  pr_number: z.number().int().positive(),
  /** Substring (typically a hidden HTML comment) that identifies the comment to find. */
  marker: z.string().min(1),
});

export type FindSummaryCommentInput = z.infer<typeof FindSummaryCommentInputSchema>;

export const UpdateSummaryCommentInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  comment_id: z.number().int().positive(),
  body: z.string().min(1),
});

export type UpdateSummaryCommentInput = z.infer<typeof UpdateSummaryCommentInputSchema>;

/** The slice of GitHub's issue-comment JSON the comment tools read. */
export const IssueCommentSchema = z.object({
  id: z.number().int(),
  html_url: z.string(),
  body: z.string().nullish(),
});

export const IssueCommentListSchema = z.array(IssueCommentSchema);
