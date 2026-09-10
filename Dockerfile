# ────────────── 1) deps ──────────────
FROM node:22-alpine AS deps
WORKDIR /app
# ⚠️ **ビルドが stdin を待てる状態にしない。** pnpm は «modules を作り直してよいか» を
#    対話で聞くことがあり、TTY が無くても既定では聞きに行く。誰も答えないので
#    Cloud Build の 60 分タイムアウトまで固まる（実測 run 34421468701）。
#    `CI=true` で pnpm は一切確認を出さなくなる。
ENV CI=true
# pnpm を有効化
RUN corepack enable

# lockfile と package.json だけ先にコピーしてキャッシュ。
#
# ⚠️ **root の package.json を必ず含めること。** corepack はここから `packageManager`
#    （pnpm@10.8.0）を読む。無いと **その時の最新の pnpm** を落としてくるので、
#    ビルドの結果が «上流が新しい版を出した日» に変わる。実際に 2026-09-10、
#    pnpm 12.3.4 が降ってきて `pnpm fetch` が ERR_PNPM_NO_LOCKFILE で落ちた
#    （12 は lockfile を親へ探しに行かなくなった）。コードは 5 日間 1 行も変えていない。
# ⚠️ pnpm-workspace.yaml も要る。これが workspace の根を決める。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/

# production 用の依存だけ取得（store は /root/.pnpm-store）
RUN cd api && pnpm fetch --prod

# ────────────── 2) builder ──────────────
FROM node:22-alpine AS builder
WORKDIR /app
ENV CI=true
RUN corepack enable

COPY --from=deps /app .

# monorepo 全体のコード
COPY . .

# devDeps を含めてインストール（build に必要）
#
# ⚠️ `--config.confirmModulesPurge=false` を明示するのは、`CI=true` が将来
#    別の理由で外れても **確認待ちで固まらない**ようにするため。ビルドが
#    人間の入力を待つ形は、失敗ではなく «60 分後にタイムアウト» になるので気づきにくい。
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false

# ビルド
WORKDIR /app/api
RUN pnpm run build

# ランタイムに devDeps は不要なので削る
RUN pnpm prune --prod

# ────────────── 3) runtime ──────────────
FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app

COPY --from=builder /app/api/dist          ./dist
COPY --from=builder /app/api/node_modules/ ./api/node_modules/
COPY --from=builder /app/node_modules/       ./node_modules/
COPY --from=builder /app/node_modules/.pnpm    ./node_modules/.pnpm 

ENV NODE_ENV=production \
    NODE_PATH=/app/api/node_modules
CMD ["dist/api/src/main.js"]