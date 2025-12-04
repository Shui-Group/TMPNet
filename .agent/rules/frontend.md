---
trigger: model_decision
description: Frontend rules for Next.js, React, and Tailwind CSS
globs: **.js, React, and Tailwind CSS
---

- **Framework**: Use **Next.js** and **React**. Follow file-based routing conventions.
- **Components**:
  - Keep components small, focused, and server-side rendered (SSR) where possible.
  - Colocate components, styles, and tests by feature.
- **State Management**:
  - Use React Hooks (`useState`, `useReducer`) for local component state.
  - Avoid global state managers unless absolutely necessary.
- **Data Fetching**:
  - Use Next.js data fetching methods (`getStaticProps`, `getServerSideProps`).
  - Handle loading, error, and empty states gracefully.
- **Styling**:
  - Use **Tailwind CSS** for all styling.
  - Define a consistent design system in `tailwind.config.js`.
- **Graph Visualization**:
  - Use **Cytoscape.js** for network graphs.
  - Encapsulate graph logic in a dedicated React component.
- **Accessibility**:
  - Ensure all components are accessible (ARIA roles, keyboard navigation).