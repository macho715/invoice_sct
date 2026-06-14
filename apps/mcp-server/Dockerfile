FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@10.32.0
COPY package.json pnpm-lock.yaml ./
ENV PNPM_HOME="/pnpm" PATH="$PNPM_HOME:$PATH"
RUN pnpm install --no-frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --create-home app
WORKDIR /app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl --fail --silent http://127.0.0.1:3000/health || exit 1
ENV PORT=3000 HOST=0.0.0.0
CMD ["node", "dist/main.js"]
