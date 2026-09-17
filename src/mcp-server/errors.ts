export class GitHubNetworkError extends Error {
  readonly category = "network" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitHubNetworkError";
  }
}

export class GitHubAuthError extends Error {
  readonly category = "auth" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitHubAuthError";
  }
}

export class GitHubNotFoundError extends Error {
  readonly category = "not_found" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitHubNotFoundError";
  }
}

export class SymbolNotFoundError extends Error {
  readonly category = "not_found" as const;
  constructor(symbol: string, path: string) {
    super(`Symbol not found in ${path}: ${symbol}`);
    this.name = "SymbolNotFoundError";
  }
}

export type GitHubMcpError =
  | GitHubNetworkError
  | GitHubAuthError
  | GitHubNotFoundError
  | SymbolNotFoundError;
