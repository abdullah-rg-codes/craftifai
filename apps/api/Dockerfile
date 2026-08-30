FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mock-model/package.json apps/mock-model/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
ENV PATH="/app/apps/api/node_modules/.bin:/app/packages/db/node_modules/.bin:/app/node_modules/.bin:${PATH}"
WORKDIR /app/apps/api
RUN groupadd --system --gid 10001 craftifai \
  && useradd --system --uid 10001 --gid craftifai --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin craftifai
USER craftifai
EXPOSE 3000
CMD ["tsx", "src/index.ts"]
