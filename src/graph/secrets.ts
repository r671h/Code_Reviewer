export interface SecretMatch {
  kind: "aws_access_key_id" | "private_key_block" | "keyword_adjacent_token";
  /** 0-based index of the line (in the scanned text) the match is on. */
  lineIndex: number;
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

  // Every pattern is single-line, so scanning line by line finds the same
  // matches while recording where each one is.
  const redactedLines = text.split("\n").map((line, lineIndex) => {
    let redacted = line;
    for (const { kind, regex } of PATTERNS) {
      redacted = redacted.replace(regex, (match) => {
        if (isDocumentedExample(match)) return match;
        matches.push({ kind, lineIndex });
        return "[REDACTED]";
      });
    }
    return redacted;
  });

  return { redacted: redactedLines.join("\n"), matches };
}

/**
 * Placeholder credentials published in AWS's own documentation. They are
 * never valid, and appear in countless READMEs and test fixtures — flagging
 * them as critical only teaches people to ignore the scanner.
 */
const DOCUMENTED_EXAMPLES = [
  "AKIAIOSFODNN7EXAMPLE",
  "AKIAI44QH8DHBEXAMPLE",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY",
];

function isDocumentedExample(match: string): boolean {
  return DOCUMENTED_EXAMPLES.some((example) => match.includes(example));
}
