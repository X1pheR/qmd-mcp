ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG VERSION=0.1.6
ARG REVISION=unknown
FROM ${NODE_IMAGE} AS build
ARG TARGETARCH

WORKDIR /opt/qmd

RUN if [ "${TARGETARCH}" = "arm64" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY patch-qmd-bind.mjs admin-server.mjs embedding-policy.mjs http-policy.mjs ./
COPY tests ./tests
RUN node ./patch-qmd-bind.mjs \
    && npm test \
    && node --check ./admin-server.mjs \
    && node --check ./embedding-policy.mjs \
    && node --check ./http-policy.mjs \
    && node --check ./node_modules/@tobilu/qmd/dist/store.js \
    && node --check ./node_modules/@tobilu/qmd/dist/cli/qmd.js \
    && npm prune --omit=dev --no-audit --no-fund \
    && case "${TARGETARCH}" in \
         amd64) llama_runtime=linux-x64 ;; \
         arm64) llama_runtime=linux-arm64 ;; \
         *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && test -d "./node_modules/@node-llama-cpp/${llama_runtime}" \
    && find ./node_modules/@node-llama-cpp \
         -mindepth 1 -maxdepth 1 -type d ! -name "${llama_runtime}" \
         -exec rm -rf {} + \
    && rm -rf ./tests /root/.npm

FROM ${NODE_IMAGE}
ARG VERSION
ARG REVISION

LABEL org.opencontainers.image.title="QMD MCP" \
      org.opencontainers.image.description="Unified QMD read and bounded administration MCP server" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/X1pheR/qmd-mcp" \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.X1pheR/qmd-mcp"

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
