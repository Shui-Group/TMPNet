# MemPPI-Atlas Codex Multiagent Guide

This directory contains project-local Codex subagent configuration for the
MemPPI-Atlas repository. It supplements the root `AGENTS.md`; it does not
replace the root project rules.

## Skills Discovery

Relevant globally installed skills from `~/.codex/skills/` include:

- `frontend-patterns`: Keep React and Next.js implementation idiomatic and
  maintainable.
- `frontend-design`: Review UI ergonomics and visual consistency for
  user-facing pages and components.
- `e2e-testing`: Plan browser-level checks for network, subgraph, and structure
  workflows when unit tests are not enough.
- `database-migrations`: Review schema and migration changes before applying
  them to Supabase.
- `postgres-patterns`: Check SQL shape, indexes, and data-contract decisions.
- `run-validation`: Execute validation checks before completion.
- `documentation-lookup`: Verify library and API behavior against docs.
- `security-review`: Check security and data-handling risks.
- `git-workflow`: Keep commits, branches, and diffs clean.

Project-local skills, if added later, should live under `.agents/skills/`.
Each skill should provide:

- `SKILL.md`: Detailed instructions and workflow.
- `agents/openai.yaml`: Optional Codex interface metadata when the skill
  provides it.

Prefer skills that support Next.js, React, Supabase/Postgres, documentation
review, and verification. Do not invent or list unavailable skills.

## Default Workflow

- Use subagents only when the user explicitly asks for multiagent or parallel
  work.
- Keep `max_depth = 1`; child agents should not recursively fan out work.
- Each custom agent must read the root `AGENTS.md` before making claims or
  edits. Read `README.md` and the relevant docs under `docs/`, `sql/`, or
  `data/` when the task touches those areas.
- The parent agent owns orchestration, final decisions, and integration.
- Remote SSH, large artifact generation, Docker orchestration, and final Git
  operations stay with the parent agent.
- Preserve the Supabase boundary: do not hard-code credentials, do not commit
  secrets, and mock Supabase/API boundaries in tests unless the parent agent
  explicitly assigns live-service validation.
- Treat raw data, generated import data, network artifacts, structure assets,
  `.next`, and ad hoc dumps as append-only or ignored unless the parent agent
  explicitly assigns cleanup.

## Roles

- `corpus_mapper`: Read-only mapping of pages, API routes, components, shared
  libs, scripts, data, SQL, Supabase migrations, tests, and docs.
- `evaluation_planner`: Read-only verification planning for API routes,
  components, pages, data transforms, Supabase schema changes, and local Docker
  workflows.
- `implementation_worker`: Scoped code, config, SQL, script, test, or docs
  edits after the parent agent assigns a specific ownership boundary.
- `reviewer`: Read-only correctness, data-contract, API, UI, security, and
  missing-test review.
- `docs_guard`: Read-only documentation drift checks for README, docs, SQL/data
  notes, local Supabase Docker notes, and shipped UI/API behavior.

## Documentation Flow

`docs_guard` reports stale wording and suggested replacements. The parent agent
performs final documentation edits so `README.md`, root `AGENTS.md`, `docs/*.md`,
`sql/README.md`, `data/README.md`, and setup notes stay synchronized.
