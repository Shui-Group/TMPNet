---
trigger: model_decision
description: Backend rules for Next.js API Routes and Supabase
---

- **API Framework**: Use **Next.js API Routes** for all backend endpoints.
  - Place API files in `pages/api/`.
- **Database**: Use **Supabase** (PostgreSQL) for data storage.
  - Interact with the database via the Supabase client library.
  - CSV data should be pre-loaded into Supabase tables.
- **API Design**:
  - Follow RESTful principles for structuring endpoints.
  - Use clear, consistent naming for routes (e.g., `/api/nodes`, `/api/edges`).
- **Data Handling**:
  - Implement server-side filtering, sorting, and pagination in Supabase queries.
  - Always validate and sanitize user input before querying the database.
- **Error Handling**:
  - Return meaningful HTTP status codes (e.g., 400 for bad requests, 404 for not found).
  - Respond with a consistent JSON error shape: `{ "error": "message" }`.
- **Security**:
  - Use environment variables for all secrets (Supabase URL and API keys).
  - Do not expose sensitive data in API responses.