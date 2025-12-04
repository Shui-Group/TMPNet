---
description: Git commit message format (Conventional Commits)
alwaysApply: true
---
- Format: type(scope): short summary
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scope: optional module/path (e.g., api, ui, data)
- Summary: imperative, <= 72 chars, no period
- Body: explain what & why; wrap ~72; blank line after summary
- Footer: BREAKING CHANGE: <details>
- Footer: Closes #123 (or References #123)
- Examples:
  - feat(api): add interactions endpoint with pagination
  - fix(ui): debounce search input to reduce API calls
  - chore: initialize project skeleton and docs
  - revert: revert feat(api): add interactions endpoint
- Guidelines:
  - Prefer small, focused commits
  - Avoid WIP; use draft PRs
  - No secrets/tokens/URLs