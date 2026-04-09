# Repository Guidelines

## Project Structure & Module Organization
This repository is a Next.js 14 Pages Router app for MemPPI network exploration. Main code lives in `src/`: UI pages in `src/pages`, API routes in `src/pages/api`, shared React components in `src/components`, and data/helpers in `src/lib`. Global styles are in `src/styles`, static assets in `public`, raw and generated datasets in `data`, import and validation utilities in `scripts`, and Supabase schema work in `supabase/` and `sql/`. Tests are split between co-located API/component tests and broader suites under `tests/api`, `tests/components`, `tests/pages`, and `tests/unit`.

## Build, Test, and Development Commands
- `npm run dev` starts the local app at `http://localhost:3000`.
- `npm run build` creates the production build; `npm run start` serves it.
- `npm run lint` runs Next.js ESLint rules.
- `npm run format` rewrites files with Prettier; `npm run format:check` verifies formatting.
- `npm test` runs the Jest suite; `npm run test:watch` is useful while iterating.
- `npm run test:coverage` checks coverage thresholds.
- `npm run prepare:data:20260407` normalizes the website dataset for Supabase import.

## Coding Style & Naming Conventions
Use TypeScript, strict mode, and the `@/` import alias for `src`. Prettier enforces 2-space indentation, semicolons, double quotes, trailing commas, and an 80-character print width. Use `PascalCase` for React components, `camelCase` for functions and variables, and descriptive API route names that match their resource, for example `src/pages/api/network/stats.ts`. Prefer extending existing modules over creating parallel helpers.

## Testing Guidelines
Jest with React Testing Library is the default stack. Name tests `*.test.ts`, `*.test.tsx`, or `*.integration.test.ts`. Mock API and Supabase boundaries instead of hitting live services. Global coverage is enforced at 70% for statements, branches, functions, and lines; keep new code at or above that bar and add regression tests with every bug fix.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits such as `feat:`, `fix:`, and `refactor:`. Keep commits focused and use the format `type(scope): summary` when a scope adds clarity. PRs should include a short problem statement, a concise change summary, test evidence (`npm test`, `npm run lint`, coverage if relevant), and screenshots or recordings for UI changes.

## Security & Configuration Tips
Store Supabase credentials in `.env.local`, typically `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not commit secrets, generated `.next` output, or ad hoc data dumps. Validate external inputs at API boundaries and review schema or migration changes carefully before merging.
