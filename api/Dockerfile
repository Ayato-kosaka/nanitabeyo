# ────────────── 1) 依存解決レイヤ ──────────────
FROM node:22-alpine AS deps
WORKDIR /app

# pnpm を有効化
RUN corepack enable

# package.json は api 用、pnpm-lock.yaml はルートから
COPY pnpm-lock.yaml ./
COPY api/package.json ./api/

# 依存を解決（node_modules はルートに置かれる）
RUN cd api && pnpm fetch --prod

# ────────────── 2) ビルドレイヤ ──────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

# 依存キャッシュをコピー
COPY --from=deps /app .

# ソースコードを全てコピー（monorepo 全体）
COPY . .

# ビルド（NestJS build スクリプト想定）
WORKDIR /app/api
RUN pnpm install --offline --prod=false \
  && pnpm run build

# ────────────── 3) 実行レイヤ ──────────────
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

# dist と依存だけコピー
COPY --from=builder /app/api/dist ./dist
COPY --from=builder /app/api/node_modules ./node_modules

ENV NODE_ENV=production
CMD ["dist/main.js"]
