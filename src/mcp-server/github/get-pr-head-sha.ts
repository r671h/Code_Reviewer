import { PullRequestHeadSchema, type GetPrHeadShaInput } from "../../schemas/github.js";
import { GitHubNetworkError } from "../errors.js";
import { githubFetchJson } from "./github-fetch.js";

/**
 * Returns the SHA of the PR's head commit — the ref file contents must be
 * read at so they match the diff's new-file line numbers. Reading without
 * a ref would return the default branch's version instead, where the
 * changed lines point at different code (or the file doesn't exist yet).
 */
export async function getPrHeadSha(input: GetPrHeadShaInput, token: string): Promise<string> {
  const [owner, name] = input.repo.split("/");
  const data = await githubFetchJson(`https://api.github.com/repos/${owner}/${name}/pulls/${input.pr_number}`, token, {
    action: `fetching PR ${input.repo}#${input.pr_number}`,
    notFoundMessage: `PR not found: ${input.repo}#${input.pr_number}`,
  });

  const parsed = PullRequestHeadSchema.safeParse(data);
  if (!parsed.success) {
    throw new GitHubNetworkError(`Unexpected GitHub response for PR ${input.repo}#${input.pr_number}: no head SHA`);
  }
  return parsed.data.head.sha;
}
