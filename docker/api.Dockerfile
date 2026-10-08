# Dev image for the API: Node + ffmpeg/ffprobe. The repository is bind-mounted at /app.
FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NX_DAEMON=false \
    NX_NO_CLOUD=true \
    npm_config_store_dir=/pnpm/store
RUN corepack enable

WORKDIR /app
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["pnpm", "nx", "serve", "api"]
