# ──────────────────────────────────────────────────────────
# 0) 共通設定
#    - ルート直下に   package.json, pnpm-workspace.yaml
#    - 各パッケージは /api, /shared, … というディレクトリ構成
#    - API は NestJS、エントリは  dist/main.js  が生成される想定
#    - PNPM 8 以上を利用           (corepack 有効化で自動)
#    - .dockerignore も後述
# ──────────────────────────────────────────────────────────


########################
# 1) deps   – lockfile だけで prod 依存を取得（キャッシュ用）
########################
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable

# lockfile とワークスペース情報だけコピー
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/
COPY shared/package.json ./shared/

# api とその依存（shared 含む）だけ production 用に取得
RUN pnpm fetch \
      --filter=./api... \
      --prod

########################
# 2) builder – devDeps を含めて build → prune
########################
FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable

# 依存キャッシュ & ソースコード
COPY --from=deps /repo .
COPY . .

# ---- install (devDeps 含む) ----
RUN pnpm install \
      --filter=./api... \
      --workspace-root \
      --frozen-lockfile

# ---- build ----
WORKDIR /repo/api
RUN pnpm run build         # -> dist/** が生成される

# ---- production prune ----
RUN pnpm prune \
      --filter=./api... \
      --prod \
      --virtual-store-dir=./api/node_modules/.pnpm

########################
# 3) runtime – distroless + isolated node_modules
########################
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

# 実行コード
COPY --from=builder /repo/api/dist            ./dist

# 依存（api/node_modules に store を閉じ込め済み）
COPY --from=builder /repo/api/node_modules    ./node_modules

# 環境変数（必要なら）
ENV NODE_ENV=production

# NestJS は PORT を読むので Cloud Run 用に 8080 を渡す
CMD ["dist/main.js"]
