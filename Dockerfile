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

# ★ point ★
# API パッケージだけ production 依存をインストール
RUN pnpm install --filter=./api... --prod --frozen-lockfile

# ビルド
WORKDIR /app/api
RUN pnpm run build

# ────────────── 3) runtime ──────────────
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

# 実行バイナリと依存をコピー
COPY --from=builder /app/api/dist ./dist
COPY --from=builder /app/api/node_modules ./node_modules
COPY --from=builder /app/api/node_modules/.pnpm ./node_modules/.pnpm  # ← symlink 先を補完

ENV NODE_ENV=production
CMD ["dist/api/src/main.js"]
