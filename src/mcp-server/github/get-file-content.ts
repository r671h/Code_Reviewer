import type { GetFileContentInput } from "../../schemas/github.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError } from "../errors.js";

export async function getFileContent(input: GetFileContentInput, token: string): Promise<string> {
  const [owner, name] = input.repo.split("/");
  const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${owner}/${name}/contents/${encodedPath}`);
  if (input.ref) {
    url.searchParams.set("ref", input.ref);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "codereviewer-mcp-server",
      },
    });
  } catch (cause) {
    throw new GitHubNetworkError(
      `Network error fetching file content for ${input.repo}:${input.path}`,
      { cause },
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new GitHubAuthError(
      `GitHub auth failed fetching file content for ${input.repo}:${input.path} (status ${response.status})`,
    );
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError(
      `File not found: ${input.repo}:${input.path}${input.ref ? ` @ ${input.ref}` : ""}`,
    );
  }
  if (!response.ok) {
    throw new GitHubNetworkError(
      `GitHub API error fetching file content for ${input.repo}:${input.path} (status ${response.status})`,
    );
  }

  return response.text();
}
