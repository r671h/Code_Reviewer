import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRelatedContext } from "../../../src/mcp-server/github/get-related-context.js";
import { GitHubAuthError } from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";

const TARGET_SOURCE = `
import { helper } from "./helper";
import lodash from "lodash";

function useIt(x: number): number {
  lodash.noop();
  return helper(x) + sibling(x);
}

function sibling(x: number): number {
  return x + 1;
}
`;

const HELPER_SOURCE = `
export function helper(x: number): number {
  return x * 2;
}
`;

function jsonOk(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as Response;
}

function jsonNotFound(): Response {
  return { ok: false, status: 404, text: async () => "" } as Response;
}

function jsonUnauthorized(): Response {
  return { ok: false, status: 401, text: async () => "" } as Response;
}

describe("getRelatedContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes called sibling and resolved local import signatures, and notes the external package", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("contents/src/target.ts")) return jsonOk(TARGET_SOURCE);
        if (s.includes("contents/src/helper.ts")) return jsonOk(HELPER_SOURCE);
        return jsonNotFound();
      }),
    );

    const result = await getRelatedContext(
      { repo: "octocat/hello-world", path: "src/target.ts", symbol: "useIt" },
      FAKE_TOKEN,
    );

    expect(result).toContain("function sibling(x: number): number");
    expect(result).toContain("function helper(x: number): number");
    expect(result).toContain("lodash");
  });

  it("falls back to index-file candidates when the direct path 404s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("contents/src/target.ts")) return jsonOk(TARGET_SOURCE);
        if (s.includes("contents/src/helper.ts")) return jsonNotFound();
        if (s.includes("contents/src/helper.tsx")) return jsonNotFound();
        if (s.includes("contents/src/helper/index.ts")) return jsonOk(HELPER_SOURCE);
        return jsonNotFound();
      }),
    );

    const result = await getRelatedContext(
      { repo: "octocat/hello-world", path: "src/target.ts", symbol: "useIt" },
      FAKE_TOKEN,
    );

    expect(result).toContain("function helper(x: number): number");
  });

  it("notes an unresolved local import instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("contents/src/target.ts")) return jsonOk(TARGET_SOURCE);
        return jsonNotFound();
      }),
    );

    const result = await getRelatedContext(
      { repo: "octocat/hello-world", path: "src/target.ts", symbol: "useIt" },
      FAKE_TOKEN,
    );

    expect(result).toMatch(/could not resolve/i);
  });

  it("propagates a real GitHub error instead of swallowing it as unresolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonUnauthorized()),
    );

    await expect(
      getRelatedContext({ repo: "octocat/hello-world", path: "src/target.ts", symbol: "useIt" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubAuthError);
  });

  it("truncates and notes omitted items when the token budget is exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("contents/src/target.ts")) return jsonOk(TARGET_SOURCE);
        if (s.includes("contents/src/helper.ts")) return jsonOk(HELPER_SOURCE);
        return jsonNotFound();
      }),
    );

    const result = await getRelatedContext(
      { repo: "octocat/hello-world", path: "src/target.ts", symbol: "useIt" },
      FAKE_TOKEN,
      5,
    );

    expect(result).toMatch(/truncated/i);
  });
});
