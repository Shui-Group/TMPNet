---
trigger: model_decision
description: Test rules for Next.js applications
---

- **Frameworks**: Use **Jest** for running tests and **React Testing Library** for rendering and interacting with components.
- **Scope**:
  - **Unit Tests**: Test individual components and functions in isolation. Mock dependencies and API calls.
  - **Integration Tests**: Test component trees or user flows. May use a mock service worker for API calls.
- **Structure**:
  - Co-locate test files with the source files (e.g., `Component.tsx` and `Component.test.tsx`).
  - Follow the Arrange-Act-Assert pattern.
- **Queries**:
  - Prefer accessible queries (`getByRole`, `getByLabelText`) over `getByTestId`.
- **Async Operations**:
  - Use `async/await` with `findBy*` or `waitFor` to handle asynchronous UI updates.
- **API Mocking**:
  - Use Jest's mocking capabilities or `msw` (Mock Service Worker) to mock Next.js API routes.
  - Never run tests against the live Supabase database.