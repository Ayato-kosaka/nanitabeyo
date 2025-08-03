# ────────────── 1) deps ──────────────
FROM node:22-alpine AS deps
WORKDIR /app
# pnpm を有効化
RUN corepack enable

# lockfile と api/package.json だけ先にコピーしてキャッシュ
COPY pnpm-lock.yaml ./
COPY api/package.json ./api/

# production 用の依存だけ取得（store は /root/.pnpm-store）
RUN cd api && pnpm fetch --prod

# ────────────── 2) builder ──────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app .

# monorepo 全体のコード
COPY . .

# devDeps を含めてインストール（build に必要）
RUN pnpm install --frozen-lockfile

# ビルド
WORKDIR /app/api
RUN pnpm run build

# ランタイムに devDeps は不要なので削る
RUN pnpm prune --prod

# ────────────── 3) runtime ──────────────
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

COPY --from=builder /app/api/dist          ./dist
COPY --from=builder /app/api/node_modules/ ./node_modules/

ENV NODE_ENV=production
CMD ["dist/api/src/main.js"]