# WorldLoom 生产镜像：Next.js standalone 输出 + pnpm
# Debian 13 keeps the production base on a maintained security line. The
# runtime stage removes package managers so their unrelated dependency tree is
# not shipped into the application image.
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Prisma's native query engine needs the system OpenSSL libraries at install,
# build and runtime. Keep the same crypto/runtime baseline in every stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV BUILD_STANDALONE=true
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate 需要 schema；DATABASE_URL 仅为通过校验，不建立连接
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm prisma generate && pnpm build

# One-shot migration image used by compose before the application accepts traffic.
# It contains the Prisma CLI and schema, but never includes application secrets.
FROM base AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
ENV NODE_ENV=production
CMD ["pnpm", "db:deploy"]

# Distroless keeps only the glibc/CA/Node runtime needed by the standalone
# application. Pin the release digest so the production base is reproducible;
# the weekly image refresh should update this digest after a fresh scan.
FROM gcr.io/distroless/nodejs24-debian13@sha256:b1fc33242cc74151f50c62b4a03d48afd759dccf81279b5f8e401db4546479c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4310 HOSTNAME=0.0.0.0
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG VERSION=unknown
LABEL org.opencontainers.image.title="WorldLoom" \
  org.opencontainers.image.source="https://github.com/betterkite/WorldLoom" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.version="${VERSION}"
COPY --from=build /app/.next/standalone ./
# Next traces the statically imported transformer package, but its ONNX/native
# dependency closure is externalized. Copy only the lockfile-selected runtime
# packages required by that closure instead of the entire production tree.
# Versions mirror pnpm-lock.yaml; update these paths together with dependency
# upgrades.
COPY --from=deps /app/node_modules/.pnpm/onnxruntime-node@1.30.0/node_modules/onnxruntime-node ./node_modules/onnxruntime-node
COPY --from=deps /app/node_modules/.pnpm/onnxruntime-common@1.30.0/node_modules/onnxruntime-common ./node_modules/onnxruntime-common
COPY --from=deps /app/node_modules/.pnpm/@huggingface+jinja@0.5.10/node_modules/@huggingface/jinja ./node_modules/@huggingface/jinja
COPY --from=deps /app/node_modules/.pnpm/@huggingface+tokenizers@0.2.0/node_modules/@huggingface/tokenizers ./node_modules/@huggingface/tokenizers
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
# prisma client + query engine are included by standalone tracing
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4310/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# The distroless base already provides /nodejs/bin/node as ENTRYPOINT.
CMD ["server.js"]
