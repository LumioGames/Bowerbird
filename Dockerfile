# Bowerbird — self-hosted on a NAS or server (docs/usage.md「Docker 部署」).
# The library folder and the machine data dir are volumes; no browser inside (the server never renders, ADR-025).
#
#   docker build -t bowerbird .
#   docker run -d -p 7420:7420 -v /path/to/library:/library -v bowerbird-data:/data bowerbird
#
# Listening on 0.0.0.0 prints the LAN warning: anyone who can reach the port can read and write the library and
# install plugins. Keep it on a trusted network; put an authenticating reverse proxy in front for anything else.

FROM node:22-bookworm-slim AS build
ENV CI=true
RUN corepack enable
# better-sqlite3 / sharp compile from source when no prebuilt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Keep only runtime dependencies (the web shell and TypeScript output are already built).
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    BOWERBIRD_HOME=/data
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /library /data
VOLUME ["/library", "/data"]
EXPOSE 7420
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:7420/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["node", "/app/packages/cli/dist/index.js"]
CMD ["serve", "/library", "--host", "0.0.0.0", "--port", "7420"]
