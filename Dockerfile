# Uses bundled BuildKit syntax; no separate Dockerfile frontend download needed.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install -g pnpm@10.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN pnpm --dir server install --frozen-lockfile
COPY client/package.json client/pnpm-lock.yaml ./client/
RUN pnpm --dir client install --frozen-lockfile
COPY shared ./shared
COPY client ./client
COPY scripts/precompress-client-assets.mjs ./scripts/precompress-client-assets.mjs
COPY config/header-footer.json ./config/header-footer.json
RUN pnpm build

FROM ${NODE_IMAGE} AS runtime
ARG TARGETARCH
ARG TYPST_VERSION=0.14.2
ENV NODE_ENV=production INTEGRATIONS_PROFILE=server HOST=0.0.0.0 PORT=5173 \
    STORAGE_UPLOADS_DIR=/data/uploads TYPST_CACHE_DIR=/data/cache \
    PATH=/opt/venv/bin:/app/node_modules/.bin:$PATH TZ=Asia/Shanghai
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl xz-utils fontconfig tzdata python3 python3-venv \
    libreoffice-writer libreoffice-calc libreoffice-draw ghostscript poppler-utils \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in amd64) arch=x86_64;; arm64) arch=aarch64;; *) exit 1;; esac \
    && curl --fail --location --retry 3 "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" -o /tmp/typst.tar.xz \
    && tar -xJf /tmp/typst.tar.xz -C /tmp \
    && install "/tmp/typst-${arch}-unknown-linux-musl/typst" /usr/local/bin/typst \
    && rm /tmp/typst.tar.xz
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server/src ./server/src
COPY shared ./shared
COPY config ./config
COPY db ./db
COPY fonts ./fonts
COPY typst-packages ./typst-packages
COPY seed-data ./seed-data
ENV TYPST_PACKAGE_PATH=/app/typst-packages
COPY samples/sample-images ./samples/sample-images
COPY deploy/docker/entrypoint.sh /usr/local/bin/cdr-entrypoint
RUN mkdir -p /data/uploads /data/cache /app/server/uploads \
    && chown -R node:node /data /app/server/uploads \
    && test -f /app/fonts/仿宋_GB2312.ttf && test -f /app/fonts/arial.ttf \
    && chmod 755 /usr/local/bin/cdr-entrypoint \
    && typst --version && soffice --version
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:5173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["cdr-entrypoint"]
CMD ["node", "--import", "tsx", "server/src/index.ts"]
