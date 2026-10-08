# syntax=docker/dockerfile:1
# Production images. One multi-stage file with two final targets:
#   --target api  Node + ffmpeg/ffprobe running the bundled API
#   --target web  nginx serving the web build and proxying /api and /media to the API

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NX_DAEMON=false \
    NX_NO_CLOUD=true
RUN corepack enable
WORKDIR /repo

FROM base AS deps
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile

FROM deps AS api-build
RUN pnpm nx build api --configuration=production
# The bundle inlines the @dfs/* libs; deploy installs only the third-party runtime dependencies.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @dfs/api deploy --prod --legacy /out/api \
  && cd /out/api \
  && rm -rf dist src drizzle *.config.* *.mjs tsconfig*.json \
  && cp -r /repo/apps/api/dist dist \
  && rm -rf dist/apps dist/*.map dist/*.tsbuildinfo

FROM deps AS web-build
RUN pnpm nx build web

FROM node:24-bookworm-slim AS api
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/data \
    DB_PATH=/var/lib/dfs/app.sqlite \
    HOST=0.0.0.0 \
    PORT=3333
WORKDIR /app
COPY --from=api-build /out/api ./
RUN mkdir -p /data /var/lib/dfs
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
