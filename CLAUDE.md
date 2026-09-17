# CLAUDE.md — Project Conventions

This file is read automatically at the start of every Claude Code session
in this repository. Follow these conventions in all generated code.

## Project
AI code review agent. See PLAN.md for architecture and build order.

## Code style
- TypeScript, strict mode enabled
- No `any` types — use Zod-inferred types or explicit interfaces
- Prefer small, pure functions over large multi-responsibility ones
- Async/await only, no raw `.then()` chains
- One export per file where practical; barrel files (`index.ts`) for
  public module surfaces only

## Folder structure
- `/src/mcp-server` — MCP server and tool implementations only.
  No LangGraph or business logic here.
- `/src/graph` — LangGraph nodes, edges, and state definition only.
  No direct GitHub API calls here — always go through MCP tools.
- `/src/schemas` — Zod schemas shared across graph and MCP layers.
- `/tests` — mirrors `/src` structure. One test file per node.

## Naming conventions
- Graph nodes: verb_noun, snake_case (e.g. `fetch_diff`, `post_summary`)
- MCP tools: verb_noun, snake_case (e.g. `get_pr_diff`)
- Zod schemas: PascalCase with `Schema` suffix (e.g. `IssueSchema`)

## Error handling
- Every LLM call must be wrapped with retry logic: exponential backoff,
  max 3 attempts, then fail the node explicitly (do not silently swallow
  errors)
- MCP tool calls that fail should surface a typed error, not a generic
  `Error` — define error types per tool category (network, auth, not_found)

## LLM output
- All LLM responses that feed into graph state must use structured output
  (Zod schema + tool use), never raw text parsing
- Never fabricate an issue if the analysis is inconclusive — return an
  empty issues array rather than guessing

## Testing
- Every graph node gets an isolated unit test with mocked LLM/MCP calls
- No end-to-end test should make a real API call in CI
- Edge cases that must always be covered: empty diff, diff >500 lines,
  no issues found

## What NOT to do
- Do not add a new dependency without checking it against
  package.json first
- Do not implement UI/dashboard code — this project is backend-only
  for now
- Do not commit real API keys or `.env` — only `.env.example`

## Review checklist (Claude's own behavior in this repo)
When reviewing a diff in this repo — whether asked explicitly or while
implementing a task that touches existing code — check for these before
calling anything done:
- **Layer boundaries**: no GitHub API calls inside `/src/graph`; no
  LangGraph orchestration or business logic inside `/src/mcp-server`.
  A violation here is a structural bug, not a style nit.
- **No `any`**: new code uses Zod-inferred types or explicit interfaces,
  never `any` or unchecked casts to get past the compiler.
- **LLM call resilience**: every LLM call is wrapped with retry logic
  (exponential backoff, max 3 attempts) and fails the node explicitly on
  exhaustion — never a silently swallowed error or a bare fallback value.
- **Typed MCP errors**: MCP tool failures surface a typed error per
  category (network, auth, not_found), not a generic `Error`.
- **Structured output only**: anything an LLM response feeds into graph
  state goes through a Zod schema + tool use — flag any raw text parsing
  of a model response.
- **No fabrication**: an inconclusive analysis returns an empty issues
  array. Treat an LLM node that always finds *something* to report as
  suspicious, not thorough.
- **Test coverage**: a new or changed graph node has a matching isolated
  test under `/tests` (mirroring `/src`), with LLM/MCP calls mocked —
  and no test hits a real API.
- **Naming**: graph nodes and MCP tools are verb_noun snake_case; Zod
  schemas are PascalCase with a `Schema` suffix.
- **Secrets**: no real API keys, tokens, or `.env` files introduced —
  only `.env.example` should change.
- **Scope**: flag unrequested UI/dashboard code, and flag any new
  dependency that wasn't checked against `package.json` first.