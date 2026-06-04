FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY src ./src
COPY packages ./packages
COPY apps ./apps
COPY qa ./qa
RUN npm ci && npm run build:ts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HELMR_PRODUCTION=true HELMR_BIND_HOST=0.0.0.0 HELMR_DATA_DIR=/var/lib/helmr/data HELMR_CONFIG_DIR=/var/lib/helmr/config
RUN useradd --system --create-home --home-dir /var/lib/helmr helmr
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/skills/builtin ./packages/skills/builtin
RUN npm ci --omit=dev && chown -R helmr:helmr /app /var/lib/helmr
USER helmr
VOLUME ["/var/lib/helmr"]
EXPOSE 3999
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3999/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/cli.js", "start", "gateway"]
