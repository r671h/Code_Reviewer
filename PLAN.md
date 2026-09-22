# Project Plan: AI Code Review Agent

## Goal
An agent that reviews GitHub pull requests automatically. On PR creation,
it fetches the diff, analyzes changed files with surrounding context
(imports, neighboring functions, related history), detects bugs, security
issues, style deviations, and N+1 patterns, and posts a structured review
comment on the PR.

## Stack
- TypeScript
- LangGraph.js (stateful agent orchestration)
- MCP (Model Context Protocol) — custom server for GitHub access
- Google Gemini API (free tier) for analysis
- Zod for structured output validation

## Architecture (LangGraph)

### Nodes
1. **fetch_diff** — calls `get_pr_diff`, parses the unified diff into
   per-file `ChangedFile[]` (path, patch, 1-indexed changed lines in the
   new file)
2. **fetch_context** — iterates `files`; for each `.ts`/`.tsx` file, calls
   `get_file_content`, maps the changed lines to enclosing top-level
   functions (`findChangedSymbols`, AST-based), and calls
   `get_related_context` per changed symbol. Non-TS files and files with
   no changed-line-containing function get an empty `relatedContext`. A
   single file's fetch failure doesn't abort the run — recorded as a
   `fileError` (stage `fetch_context`), the file still gets a context
   entry so `analyze` can proceed on diff alone.
3. **analyze** — iterates `fileContexts`; one Gemini call per file with
   Zod-schema-constrained structured output (`AnalysisResultSchema`),
   wrapped in `withRetry` (exponential backoff, max 3 attempts). A file
   whose analysis exhausts retries is recorded as a `fileError` (stage
   `analyze`) and skipped — same resilience policy as `fetch_context`,
   not an abort.
4. **decide_verdict** — pure function: `REQUEST_CHANGES` if any issue is
   `critical`, else `COMMENT` if any issues exist, else `APPROVE`.
5. **conditional edge** on `decide_verdict` → `format_review` (issues
   exist) or `format_no_issues` (none) — the conditional-routing
   showcase, and it doubles as the "no issues found" edge case.
6. **format_review** / **format_no_issues** — pure functions building the
   final Markdown review text (issues grouped by file, sorted by
   severity; `fileErrors` always listed under "Notes", never hidden).
7. **deliver_review** — terminal node, swappable: `print_review` (logs
   `reviewText` via an injected `print` function — the local/dry-run
   default) or `post_review` (posts it as a real PR comment via
   `post_summary_comment` — what `--post` and the GitHub Action use). The
   graph itself takes a `deliverReview` node function and doesn't know
   which implementation it got; `src/agent.ts` picks based on `--post`.

Every node is `(state) => Partial<GraphStateType>` (or a factory
`makeXNode(deps) => (state) => ...` when it needs injected
dependencies — MCP tool functions, the LLM caller, `print`/
`postSummaryComment`). Dependencies are passed explicitly, never read
from module-level globals, so each node is unit-testable with
fakes/mocks in isolation.

**fetch_context and analyze iterate their file list internally rather
than fanning out via LangGraph's `Send` API.** This resolves the
diff-processing-strategy question below in favor of the simpler shape:
each file still gets its own LLM call (so a single call never sees more
than one file's patch — the actual fix for the >500-line-diff edge case),
and a single file's failure still doesn't abort the run. What `Send`
would add on top is graph-level parallelism/isolation between files,
which wasn't worth gating this delivery on without dedicated verification
of `Send`'s typed integration in this LangGraph version. Valid future
upgrade, not a correctness gap today.

### State shape (`src/graph/state.ts`, via `Annotation.Root`)
```
{
  repo: string
  prNumber: number
  files: ChangedFile[]            // { path, patch, changedLines }
  fileContexts: FileContext[]     // { path, patch, relatedContext }
  issues: Issue[]                 // { file, line, severity, category, explanation }
  fileErrors: FileError[]         // { path, stage: "fetch_context" | "analyze", message }
  verdict: "APPROVE" | "COMMENT" | "REQUEST_CHANGES" | undefined
  reviewText: string | undefined
}
```

### LLM call (`src/graph/llm.ts`)
`@langchain/google-genai`'s `ChatGoogleGenerativeAI.withStructuredOutput(AnalysisResultSchema)`
— LangChain's standard "Zod schema + tool use" structured-output
mechanism, not a hand-rolled raw-text-then-parse loop. Model:
`gemini-3.6-flash` by default (override via `options.model`) — Google
retired `gemini-2.0-flash` sometime after this plan's original Gemini
model guess; found out by hitting the live 404 and reading the error's
own suggested replacement, not by prior knowledge. `AnalysisResultSchema`
avoids `.positive()`/`.negative()` Zod refinements — they compile to
`exclusiveMinimum`/`exclusiveMaximum` in the JSON Schema Gemini's
`responseJsonSchema` doesn't accept (`.min(1)` instead; regression-guarded
in `tests/schemas/review.test.ts`).

## MCP Server — tools
- `get_pr_diff(repo, pr_number)` → unified diff string. **Implemented.**
- `get_file_content(repo, path, ref)` → file contents. **Implemented.**
- `get_related_context(repo, path, symbol)` → one-hop AST-derived context:
  signatures of same-file sibling functions called by `symbol`, plus
  signatures of repo-local imports it uses (external packages noted by
  name only). Capped at ~2000 tokens. See design below. **Implemented.**
- `post_summary_comment(repo, pr_number, body)` → posts one Markdown
  comment via the issue-comments endpoint (PRs are issues for commenting
  purposes). **Implemented.** Deliberately not the "create a review"
  endpoint with per-line positioned comments — see
  `post_review_comment` below.
- `post_review_comment(repo, pr_number, file, line, body)` — **not
  implemented.** Needs mapping an issue's line number to the diff's
  `position` field for GitHub's review-comments API, which is unresolved
  design work (see open questions). One summary comment
  (`post_summary_comment`) covers the actually-shipped path today.

### `get_related_context` design
One-hop, AST-based (TypeScript compiler API via `ts.createSourceFile`,
not regex, not a full call-graph). Given `(repo, path, symbol)`:
1. Fetch `path`'s content (via `get_file_content`) and parse it.
2. Locate the top-level declaration named `symbol` — a function
   declaration, or a top-level `const x = (...) => ...` /
   `function (...) {}` assignment.
3. Walk that symbol's body once:
   - Collect identifiers that resolve (by name) to a top-level import
     binding → "used imports." For each, resolve the import's module
     specifier:
     - Relative path (`./`, `../`) → resolve within the repo, fetch
       that file, parse it, and pull just the matching export's
       signature (name, params, return type, JSDoc) — not its body.
     - Bare package specifier (e.g. `react`) → out of scope; note the
       package name only, no fetch/parse.
   - Collect `CallExpression`s whose callee is a plain identifier
     matching another top-level function declared in the *same* file
     → "sibling functions called by the changed function." Their
     signatures come from the same parse, no extra fetch.
4. Format as text, capped at ~2000 tokens (approximated as
   `chars / 4` — no tokenizer dependency for a fuzzy budget). Priority
   when truncating: called siblings first, then called local imports,
   then merely-referenced local imports, then external-package notes
   last.

**Explicit v1 scope limits:**
- One hop only — no transitive resolution through an imported file's
  own imports.
- No cross-repo resolution — `node_modules` imports are noted by
  package name only, never fetched.
- No non-JS/TS files.
- Identifier matching is syntactic (by name), not full semantic
  resolution via the TypeScript type checker. A locally shadowed
  variable that happens to share a name with an import binding or a
  sibling function could produce a false positive. Known limitation,
  not fixed in v1.

**Implementation note:** the installed `typescript` package is v7 (the
native/Go compiler rewrite), which no longer ships the classic
`createSourceFile`/`SyntaxKind` AST API — only `version.cjs` and an
unstable project-service API. The classic compiler API is installed
separately as a runtime dependency under an npm alias
(`typescript-compiler-api` → `npm:typescript@^5`) so it doesn't
conflict with the `typescript@7` devDependency used to build this
project.

## Repository structure (actual)
```
/src
  /mcp-server
    errors.ts             -> typed error classes (network/auth/not_found)
    server.ts              -> McpServer, registers all four tools
    index.ts                -> stdio entry point (real MCP server process)
    /github
      get-pr-diff.ts
      get-file-content.ts
      get-related-context.ts
      post-summary-comment.ts
      related-context-ast.ts -> pure AST helpers (analyzeSymbol, extractSignature, findChangedSymbols)
  /graph
    state.ts                 -> Annotation.Root state definition
    diff.ts                  -> parseUnifiedDiff, truncatePatch (pure)
    retry.ts                 -> withRetry / RetryExhaustedError (pure)
    llm.ts                   -> createAnalyzeFile (Gemini + structured output + retry)
    graph.ts                 -> buildReviewGraph: wires nodes + edges, takes an
                                 injected deliverReview terminal node
    /nodes                   -> one file per node (see Architecture above),
                                 including print_review and post_review
  /schemas
    github.ts                -> MCP tool input schemas
    review.ts                -> IssueSchema, AnalysisResultSchema
  agent.ts                   -> real CLI entry point: <owner/repo> <pr_number> [--post]
/tests                       -> mirrors /src
/scripts                     -> manual demo scripts (real API calls, not in the test suite)
  demo-get-pr-diff.ts
  demo-get-file-content.ts
  demo-get-related-context.ts
  demo-review.ts             -> full graph, streams intermediate state per node
action.yml                   -> composite GitHub Action wrapping src/agent.ts --post
/.github/workflows
  review.yml                 -> dogfoods this repo's own PRs via `uses: ./`
CLAUDE.md
PLAN.md
README.md                    -> functional usage doc (not the portfolio writeup)
.env.example
```

## Build order
1. ~~Project skeleton + CLAUDE.md conventions~~ **Done.**
2. ~~MCP tool: `get_pr_diff`~~ **Done**, verified against a real PR.
3. ~~MCP tool: `get_file_content`~~ **Done**, verified against real files.
4. ~~MCP tool: `get_related_context`~~ **Done**, verified against real
   production TypeScript (`modelcontextprotocol/typescript-sdk`).
5. ~~Graph: `fetch_diff` + `fetch_context` nodes~~ **Done.**
6. ~~Graph: `analyze` node with Zod structured output~~ **Done**, Gemini
   via `@langchain/google-genai`.
7. ~~Graph: `decide_verdict` conditional routing + `format_review` /
   `format_no_issues` / `print_review`~~ **Done.** Verified end-to-end
   against a real PR (`r671h/MyMessenger#9`) — found a real CORS security
   issue and a real undefined-value bug, routed to `REQUEST_CHANGES`.
8. ~~Error handling: retry with exponential backoff on LLM calls~~
   **Done** (`withRetry`, max 3 attempts; a file that exhausts retries is
   skipped with a note, not an abort).
9. ~~Unit tests per node (mocked LLM/MCP calls)~~ **Done**, 77 tests
   across the project, all mocked — the suite makes no real API calls.
10. ~~Edge cases~~ **Done:**
    - Empty diff / no code changes: `parseUnifiedDiff("")` → `[]`;
      `fetch_context`/`analyze` make zero MCP/LLM calls on an empty file
      list; a pure rename with no hunks parses to an empty patch instead
      of crashing; routes to `format_no_issues`, which reports "0 files
      reviewed" honestly rather than fabricating anything.
    - Config-files-only diff: non-`.ts`/`.tsx` files (verified with both
      `README.md` and `package.json`) skip AST context but still flow
      into `analyze` — the model still gets a chance to flag something
      real (e.g. a leaked secret in a config change), it just doesn't get
      AST-derived related context for it.
    - Diff >500 lines: **implemented**, not just tested — `truncatePatch`
      (`src/graph/diff.ts`) caps a single file's patch at 500 lines before
      it reaches the LLM, applied in the `analyze` node. Per-file calls
      already kept a whole large PR bounded (no call sees more than one
      file's patch); this covers one file itself being 500+ lines.
    - No issues found: `decide_verdict` → `APPROVE`, `format_no_issues`
      only ever echoes `state.issues`/`state.fileErrors` — it can't
      invent anything since it never generates content, only formats
      what's already there. The actual "don't invent an issue" guarantee
      lives in the prompt (`src/graph/llm.ts`): explicit instruction to
      return an empty array when inconclusive, which is what an LLM unit
      test can't verify without a real call — the live run in the
      previous session (`r671h/MyMessenger#9`) exercised the opposite
      case (real issues, correctly found) as the closest available
      real-world check.
11. ~~CLI entry point (`agent.ts`)~~ **Done**: `agent.ts <owner/repo>
    <pr_number> [--post]`. Verified live in print mode
    (`r671h/MyMessenger#9`, found the same real CORS issue as the earlier
    graph-level run). Verified live in `--post` mode too
    (`r671h/MyMessenger#9`, comment id `5776561792`): posted a real
    `REQUEST_CHANGES` verdict with a critical security issue found in
    `server/index.ts`. Caveat from that run: `agent.ts` logs nothing on
    a successful `--post`, so a re-run isn't visibly distinguishable
    from a first run — a second invocation posted a duplicate comment,
    which had to be deleted by hand. Fixed: `agent.ts` now logs
    `Posted review comment on <repo>#<pr>` after a successful `--post`
    run, so a re-run is no longer silently indistinguishable from a
    first run.
12. ~~`post_summary_comment` MCP tool + `post_review` node~~ **Done**,
    unit-tested (mocked `fetch`/mocked tool call, no real posts in the
    suite).
13. ~~Package as a GitHub Action~~ **Done**: `action.yml` (composite
    action: `actions/setup-node` → `npm ci` → `agent.ts --post`, both
    steps running in `github.action_path` so it works when consumed by
    another repo, not just this one) + `.github/workflows/review.yml`
    dogfooding this repo's own PRs. **Caveat: unverified against a real
    Actions run** — this repo isn't pushed to GitHub yet, so nothing
    about the workflow YAML or the composite action has actually been
    exercised by the GitHub Actions runner, unlike everything else in
    this plan. Push and open a PR to find out if it actually works.
14. Not built yet: `post_review_comment` (inline per-line comments,
    blocked on diff-position mapping — see open questions), README for
    portfolio (current README.md is a functional usage doc, not that).

## Resolved decisions
- Comment output: **both** modes exist now — console (`print_review`,
  still the default with no flag) and a real PR comment (`post_review`,
  via `--post` or the GitHub Action). Originally "console only for the
  MVP"; revisited once the analysis logic was validated against a real
  PR, per the original plan for when to revisit this.
- Trigger: **both** now — manual CLI (unchanged) **and** a GitHub Action
  (`action.yml`) triggered on `pull_request: [opened, synchronize,
  reopened]`. Originally "CLI only for the MVP, no Action"; revisited
  once the graph was proven working end-to-end.
- GitHub auth: Personal Access Token via `GITHUB_TOKEN` env var for
  local/CLI use; the workflow-provided `secrets.GITHUB_TOKEN` (no custom
  PAT) for the GitHub Action, since it only needs `contents:read` +
  `pull-requests:write` on the repo the workflow already runs in.
- LLM provider: Google Gemini API (free tier), not Anthropic.

## Open questions
- Which repo(s) will be used for ongoing testing? Still open in general —
  the MCP tools and the graph work against any repo/PR the token can
  access. `r671h/MyMessenger` has been used for live verification so far.
- Diff processing strategy: **resolved** — per-file LLM calls via an
  internal loop in `fetch_context`/`analyze`, not `Send`-based fan-out.
  See the Architecture section above for why.
- Failure policy: **resolved** — skip the file, record a `fileError`,
  keep going. Implemented identically in both `fetch_context` and
  `analyze`.
- Inline per-line review comments (`post_review_comment`): not built.
  Would need mapping `decide_verdict`'s verdict to a GitHub PR review
  `event` (`APPROVE`/`COMMENT`/`REQUEST_CHANGES` line up with GitHub's
  own event names, which is promising) and each issue's line number to
  the diff's `position` field for the "create a review" endpoint's
  per-comment anchoring. `post_summary_comment` (implemented) sidesteps
  this entirely by posting one comment instead.
- The GitHub Action has since run for real on GitHub's own Actions
  runners, repeatedly, dogfooding this repo's own PRs via
  `.github/workflows/review.yml` (see build-order item 13) — including
  one real bug it caught in its own codebase and one confident false
  positive, both left visible in this repo's PR history. Still open:
  a real giant PR (500+ lines, many files) hasn't been run through it
  live — only through a synthetic-PR unit test
  (`tests/graph/large-pr.test.ts`).