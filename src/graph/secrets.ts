export interface SecretMatch {
  kind: "aws_access_key_id" | "private_key_block" | "keyword_adjacent_token";
}

export interface SecretScanResult {
  redacted: string;
  matches: SecretMatch[];
}

interface SecretPattern {
  kind: SecretMatch["kind"];
  regex: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { kind: "aws_access_key_id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "private_key_block", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  {
    kind: "keyword_adjacent_token",
    // No leading \b: real-world names are often SNAKE_CASE compounds like
    // DATABASE_PASSWORD, where `_` (a word char) sits right before the
    // keyword and blocks a \b boundary there. An optional quote before the
    // ':'/'=' handles JSON/YAML-style `"secret": "..."`.
    regex: /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)['"]?\s*[:=]\s*['"]?[A-Za-z0-9+/_=-]{16,}['"]?/gi,
  },
];

/**
 * Heuristically scans `text` for common secret shapes (AWS access key IDs,
 * private key blocks, and long base64/hex-looking values assigned next to
 * words like api_key/secret/token/password) and returns a copy with every
 * match replaced by `[REDACTED]`, plus which kinds were found. Not a
 * guarantee — a heuristic net, not a secret scanner — but it means no
 * literal match reaches the LLM prompt.
 */
export function redactSecrets(text: string): SecretScanResult {
  const matches: SecretMatch[] = [];

  let redacted = text;
  for (const { kind, regex } of PATTERNS) {
    redacted = redacted.replace(regex, () => {
      matches.push({ kind });
      return "[REDACTED]";
    });
  }

  return { redacted, matches };
}
