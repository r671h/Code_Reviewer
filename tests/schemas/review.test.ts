import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnalysisResultSchema } from "../../src/schemas/review.js";

// Gemini's responseJsonSchema only accepts a restricted JSON Schema subset.
// exclusiveMinimum/exclusiveMaximum (emitted by Zod for `.positive()`,
// `.negative()`, etc.) aren't in it and the API call fails outright — this
// regression-guards the schema actually used for structured output.
describe("AnalysisResultSchema JSON schema compatibility", () => {
  it("does not use exclusiveMinimum/exclusiveMaximum, which Gemini's structured output rejects", () => {
    const jsonSchema = z.toJSONSchema(AnalysisResultSchema);

    const serialized = JSON.stringify(jsonSchema);
    expect(serialized).not.toContain("exclusiveMinimum");
    expect(serialized).not.toContain("exclusiveMaximum");
  });
});
