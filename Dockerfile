FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY postcss.config.cjs tailwind.config.cjs vitest.config.ts vitest.setup.ts ./
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/workflow-builder/dist ./public
COPY --from=build --chown=node:node /app/apps/workflow-builder/dist-server ./server
COPY --chown=node:node apps/workflow-builder/package.runtime.json ./package.json
COPY --chown=node:node LICENSE ./LICENSE
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.js"]
