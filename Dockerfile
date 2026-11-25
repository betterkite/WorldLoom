# WorldLoom 生产镜像：Next.js standalone 输出 + pnpm
# Build and dependency installation use the pinned Debian toolchain.
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Prisma's native query engine needs the system OpenSSL libraries at install,
# build. The final Ubuntu images supply the OpenSSL 3 ABI separately.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# One-shot migration image used by compose before the application accepts traffic.
# A dedicated lockfile keeps UI, embedding and development packages out of it.
FROM base AS migrate-deps
WORKDIR /migration
COPY docker/migrate/package.json docker/migrate/pnpm-lock.yaml docker/migrate/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# The Ubuntu 24.04 chiseled root contains glibc, OpenSSL, CA roots and the
# package inventory and copyrights for those files. Both roles use the same
# upstream Node executable and its complete license from the pinned toolchain.
FROM mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled@sha256:2bb1d484500b032aaafb75e876ffbea135b969d6259cacfcbf18a793e5d6e6ec AS runtime-base
COPY --from=base /usr/local/bin/node /nodejs/bin/node
COPY --from=base /usr/local/LICENSE /nodejs/LICENSE
ENV PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 65532:65532
WORKDIR /app

FROM runtime-base AS migrate
COPY --from=migrate-deps /migration/node_modules ./node_modules
COPY docker/migrate/package.json ./package.json
COPY prisma ./prisma
COPY LICENSE ./LICENSE
ARG VCS_REF=unknown
ARG VERSION=unknown
LABEL org.opencontainers.image.title="WorldLoom Migration" \
  org.opencontainers.image.source="https://github.com/betterkite/WorldLoom" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/client-only ./packages/client-only
# The npm tarball already carries CPU runtimes. Avoid the optional ONNX GPU
# postinstall download so the lockfile governs every binary entering the build.
RUN ONNXRUNTIME_NODE_INSTALL=skip pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV BUILD_STANDALONE=true
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate 需要 schema；DATABASE_URL 仅为通过校验，不建立连接
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm prisma generate && pnpm build \
  && node scripts/restore-standalone-licenses.mjs /app /app/.next/standalone \
  && node scripts/stage-prisma-engine-provenance.mjs /app /app/.next/standalone
ARG TARGETARCH
RUN node scripts/prepare-onnx-runtime.mjs \
  /app/node_modules/.pnpm/onnxruntime-node@1.30.0/node_modules/onnxruntime-node \
  /app/.onnx-runtime "$TARGETARCH"
# Collect originals for the entire installed production graph, including
# dependencies embedded in browser chunks. Keep staging outside tracing inputs.
RUN pnpm list --prod --depth Infinity --json > /tmp/production-dependencies.json \
  && node scripts/stage-production-notices.mjs stage \
  /app /tmp/production-dependencies.json /tmp/worldloom-production-notices

# Assemble and validate the exact app/worker payload before copying it into
# distroless. Build tools and the verifier stay out of the release image.
FROM base AS runtime-payload
WORKDIR /app
COPY --from=build /app/.next/standalone ./
# Older retained standalone outputs may predate the context exclusions. Remove
# local workstation metadata before copying this payload into the fresh runtime.
RUN rm -f /app/.reposteward.toml /app/.DS_Store
# Next traces transformers, but externalizes the ONNX/native dependency closure.
# Versioned paths must be updated together with pnpm-lock.yaml.
COPY --from=build /app/.onnx-runtime ./node_modules/onnxruntime-node
COPY --from=deps /app/node_modules/.pnpm/onnxruntime-common@1.30.0/node_modules/onnxruntime-common ./node_modules/onnxruntime-common
COPY --from=deps /app/node_modules/.pnpm/@huggingface+jinja@0.5.10/node_modules/@huggingface/jinja ./node_modules/@huggingface/jinja
COPY --from=deps /app/node_modules/.pnpm/@huggingface+tokenizers@0.2.0/node_modules/@huggingface/tokenizers ./node_modules/@huggingface/tokenizers
COPY scripts/deduplicate-onnx-runtime.mjs /tmp/deduplicate-onnx-runtime.mjs
RUN node /tmp/deduplicate-onnx-runtime.mjs /app
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
# Copy exact-tag upstream licenses and component notices into matching runtime
# packages. This does not certify native/bundled distribution obligations.
COPY third_party/runtime-licenses/next-env-16.4.5.LICENSE /tmp/runtime-license-sources/
COPY third_party/runtime-licenses/onnxruntime-1.30.0.LICENSE /tmp/runtime-license-sources/
COPY third_party/runtime-licenses/onnxruntime-1.30.0-ThirdPartyNotices.txt /tmp/runtime-license-sources/
COPY third_party/runtime-licenses/sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md /tmp/runtime-license-sources/
COPY third_party/runtime-licenses/sharp-components /tmp/runtime-license-sources/sharp-components
COPY scripts/runtime-license-audit.mjs scripts/stage-versioned-runtime-notices.mjs /tmp/
RUN node /tmp/stage-versioned-runtime-notices.mjs /app /tmp/runtime-license-sources
# Keep the source/hash index beside the original texts at the stable path linked
# by THIRD_PARTY_NOTICES.md; per-package copies alone omit that provenance.
COPY third_party/runtime-licenses/sharp-components /app/third_party/runtime-licenses/sharp-components
COPY third_party/runtime-licenses/browser-components /app/third_party/browser-components
COPY third_party/runtime-licenses/next-vendored /app/third_party/next-vendored
# Reuse the complete copies above for source-relative links in THIRD_PARTY_NOTICES.
# Standalone tracing can leave partial directories at these two paths.
RUN cd /app/third_party/runtime-licenses \
  && rm -rf next-vendored browser-components \
  && ln -s ../next-vendored next-vendored \
  && ln -s ../browser-components browser-components
COPY --from=build /tmp/worldloom-production-notices /app/third_party/production-dependencies
COPY scripts/stage-production-notices.mjs /tmp/stage-production-notices.mjs
RUN node /tmp/stage-production-notices.mjs verify /app/third_party/production-dependencies /app/third_party/browser-components
COPY scripts/verify-next-vendored-notices.mjs /tmp/verify-next-vendored-notices.mjs
RUN node /tmp/verify-next-vendored-notices.mjs /app
COPY scripts/verify-image-payload.mjs /tmp/verify-image-payload.mjs
COPY scripts/font-assets-audit.mjs /tmp/font-assets-audit.mjs
RUN node /tmp/verify-image-payload.mjs /app

FROM runtime-base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4310 HOSTNAME=0.0.0.0
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG VERSION=unknown
LABEL org.opencontainers.image.title="WorldLoom" \
  org.opencontainers.image.source="https://github.com/betterkite/WorldLoom" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.version="${VERSION}"
COPY --from=runtime-payload /app ./
# prisma client + query engine are included by standalone tracing
USER 65532:65532
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4310/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["server.js"]
