import { z } from "zod";

export const IssueSchema = z.object({
  file: z.string().describe("Path of the file the issue is in."),
  line: z.number().int().min(1).describe("1-indexed line number in the new version of the file."),
  severity: z.enum(["critical", "warning", "info"]).describe("How serious the issue is."),
  category: z
    .enum(["bug", "security", "style", "n_plus_one"])
    .describe("What kind of issue this is."),
  explanation: z.string().describe("Concise explanation of the issue and why it matters."),
});

export type Issue = z.infer<typeof IssueSchema>;

export const AnalysisResultSchema = z.object({
  issues: z
    .array(IssueSchema)
    .describe("Issues found in this file's changes. Empty if the analysis is inconclusive or finds nothing."),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
