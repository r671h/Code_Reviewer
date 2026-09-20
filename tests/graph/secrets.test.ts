import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/graph/secrets.js";

describe("redactSecrets", () => {
  describe("realistic secret patterns", () => {
    it("detects and redacts an AWS access key ID", () => {
      const text = 'const client = new S3Client({ accessKeyId: "AKIAIOSFODNN7EXAMPLE" });';

      const result = redactSecrets(text);

      expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.redacted).toContain("[REDACTED]");
      expect(result.matches.map((m) => m.kind)).toContain("aws_access_key_id");
    });

    it("detects and redacts a private key block", () => {
      const text = [
        "-----BEGIN RSA PRIVATE KEY-----",
        "MIIEpAIBAAKCAQEA1c7+9z5Pad7OejecsQ0bu3aumnAxuNbZ/HddQLoZOgqrKfyk",
        "-----END RSA PRIVATE KEY-----",
      ].join("\n");

      const result = redactSecrets(text);

      expect(result.redacted).not.toContain("-----BEGIN RSA PRIVATE KEY-----");
      expect(result.matches.map((m) => m.kind)).toContain("private_key_block");
    });

    it("detects a generic api_key assignment with a long token value", () => {
      const text = 'const config = { api_key: "notarealkey_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" };';

      const result = redactSecrets(text);

      expect(result.redacted).not.toContain("notarealkey_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
      expect(result.matches.map((m) => m.kind)).toContain("keyword_adjacent_token");
    });

    it("detects a password assignment with a long value", () => {
      const text = 'DATABASE_PASSWORD="Sup3rSecretPassw0rd12345"';

      const result = redactSecrets(text);

      expect(result.redacted).not.toContain("Sup3rSecretPassw0rd12345");
      expect(result.matches.map((m) => m.kind)).toContain("keyword_adjacent_token");
    });

    it("detects a bearer/secret token assigned with colon syntax (e.g. YAML/JSON)", () => {
      const text = '"secret": "0123456789abcdef0123456789abcdef"';

      const result = redactSecrets(text);

      expect(result.redacted).not.toContain("0123456789abcdef0123456789abcdef");
      expect(result.matches.map((m) => m.kind)).toContain("keyword_adjacent_token");
    });

    it("reports no matches for ordinary code with none of these patterns", () => {
      const text = "export function add(a: number, b: number): number {\n  return a + b;\n}";

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
      expect(result.redacted).toBe(text);
    });
  });

  describe("false-positive guards", () => {
    it("does not flag a git diff header's 40-char SHA hashes (no keyword nearby)", () => {
      const text = "index e69de29a1b2c3d4e5f60718293a4b5c6d7e8f9a0..b6fc4c6a1b2c3d4e5f60718293a4b5c6d7e8f9a1 100644";

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
    });

    it("does not flag a short placeholder-style token below the length threshold", () => {
      const text = 'api_key: "test"';

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
    });

    it("does not flag a token variable being read, not assigned a literal", () => {
      const text = "const token = getAuthToken(currentUser);";

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
    });

    it("does not flag a Zod schema field declaration with no literal value", () => {
      const text = "password: z.string().min(8).max(72),";

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
    });

    it("does not flag the word 'secret' used in an unrelated sentence", () => {
      const text = "// This function keeps the retry logic secret from the caller, by design.";

      const result = redactSecrets(text);

      expect(result.matches).toEqual([]);
    });
  });

  it("redacts every match when the same text has multiple secrets", () => {
    const text = [
      'accessKeyId: "AKIAIOSFODNN7EXAMPLE"',
      'api_key: "notarealkey_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"',
    ].join("\n");

    const result = redactSecrets(text);

    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redacted).not.toContain("notarealkey_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(result.matches).toHaveLength(2);
  });
});
