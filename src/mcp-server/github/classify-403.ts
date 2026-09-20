/**
 * GitHub returns 403 for both real auth/permission failures (bad token,
 * insufficient scope, "Resource not accessible by integration") and rate
 * limiting — primary (x-ratelimit-remaining hits 0) or secondary/abuse
 * detection (a retry-after header, and/or the body mentioning "rate
 * limit"). Conflating the two as one GitHubAuthError misleads diagnosis.
 * Only meaningful for a 403 response — GitHub never uses 401 for rate
 * limiting.
 */
export function isGitHubRateLimited(response: Response, bodyText: string): boolean {
  if (response.headers.get("x-ratelimit-remaining") === "0") return true;
  if (response.headers.get("retry-after") !== null) return true;
  return /rate limit/i.test(bodyText);
}
