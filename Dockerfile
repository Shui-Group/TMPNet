# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV MEMPPI_DATA_MODE=file
ENV MEMPPI_DATA_ROOT=/app/data/supabase-import/20260514_new_web_data
ENV STRUCTURE_ASSET_ROOT=/app/data/raw/20260514_new_web_data/best_structure
ENV NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET=structure-models
ENV SUPABASE_STRUCTURE_BUCKET=structure-models

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV MEMPPI_DATA_MODE=file
ENV MEMPPI_DATA_ROOT=/app/data/supabase-import/20260514_new_web_data
ENV STRUCTURE_ASSET_ROOT=/app/data/raw/20260514_new_web_data/best_structure
ENV NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET=structure-models
ENV SUPABASE_STRUCTURE_BUCKET=structure-models

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/data/supabase-import/20260514_new_web_data ./data/supabase-import/20260514_new_web_data
COPY --from=builder --chown=nextjs:nodejs /app/data/raw/20260514_new_web_data/best_structure ./data/raw/20260514_new_web_data/best_structure
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
