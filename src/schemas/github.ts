import { z } from "zod";

export const GetPrDiffInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  pr_number: z.number().int().positive(),
});

export type GetPrDiffInput = z.infer<typeof GetPrDiffInputSchema>;

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
});

export type GetRelatedContextInput = z.infer<typeof GetRelatedContextInputSchema>;

export const PostSummaryCommentInputSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be in "owner/repo" format'),
  pr_number: z.number().int().positive(),
  body: z.string().min(1),
});

export type PostSummaryCommentInput = z.infer<typeof PostSummaryCommentInputSchema>;
