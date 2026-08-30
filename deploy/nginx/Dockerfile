FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/mock-model/package.json apps/mock-model/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @craftifai/web build

FROM nginx:1.27-alpine
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/api/health || exit 1
