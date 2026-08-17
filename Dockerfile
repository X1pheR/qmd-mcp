ARG NODE_IMAGE=node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066
ARG VERSION=0.1.1
ARG REVISION=unknown
FROM ${NODE_IMAGE} AS build

WORKDIR /opt/qmd

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY patch-qmd-bind.mjs admin-server.mjs ./
RUN node ./patch-qmd-bind.mjs \
    && node --check ./admin-server.mjs \
    && node --check ./node_modules/@tobilu/qmd/dist/store.js \
    && node --check ./node_modules/@tobilu/qmd/dist/cli/qmd.js \
    && test -d ./node_modules/@node-llama-cpp/linux-x64 \
    && find ./node_modules/@node-llama-cpp \
         -mindepth 1 -maxdepth 1 -type d ! -name linux-x64 \
         -exec rm -rf {} + \
    && rm -rf /root/.npm

FROM ${NODE_IMAGE}
ARG VERSION
ARG REVISION

LABEL org.opencontainers.image.title="QMD MCP" \
      org.opencontainers.image.description="Unified QMD read and bounded administration MCP server" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/X1pheR/qmd-mcp" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PATH=/opt/qmd/node_modules/.bin:${PATH} \
    HOME=/data/home \
    XDG_CACHE_HOME=/data/cache \
    QMD_CONFIG_DIR=/config \
    QMD_CONFIG_PATH=/config/index.yml \
    INDEX_PATH=/data/index.sqlite \
    QMD_HTTP_HOST=0.0.0.0 \
    QMD_FORCE_CPU=0

WORKDIR /opt/qmd

COPY --from=build --chown=node:node /opt/qmd /opt/qmd

RUN mkdir -p /data/home /data/cache /config \
    && ln -s /opt/qmd/node_modules/.bin/qmd /usr/local/bin/qmd \
    && chown -R node:node /data /config

USER node

EXPOSE 8181

CMD ["node", "/opt/qmd/admin-server.mjs"]
