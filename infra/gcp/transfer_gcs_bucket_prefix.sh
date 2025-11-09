#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# transfer_gcs_bucket_prefix.sh
# ------------------------------------------------------------------------------
# 目的:
#   - GCS バケット間で「指定プレフィックス配下」のオブジェクトを転送
#   - 既存オブジェクトがあっても上書き（overwrite）
#   - 転送後にオブジェクト数と合計サイズをレポート（src / dst / 差分）
#
# 使い方:
#   chmod +x transfer_gcs_bucket_prefix.sh
#   ./transfer_gcs_bucket_prefix.sh <SRC_BUCKET> <SRC_PREFIX> <DST_BUCKET> [DST_PREFIX]
#
# 引数:
#   SRC_BUCKET : コピー元バケット名（例: my-src-bucket）
#   SRC_PREFIX : コピー元プレフィックス（例: data/2024/）※配下を再帰的に転送
#   DST_BUCKET : コピー先バケット名（例: my-dst-bucket）
#   DST_PREFIX : コピー先プレフィックス（省略時: SRC_PREFIX と同じ）
#
# 前提:
#   - gcloud CLI が利用可能（gcloud storage コマンドが使える）
#   - 実行ユーザーに Storage オブジェクトの読み/書き権限（最低: Storage Object Admin 相当）
#
# 作成/操作する主なリソース:
#   - なし（オブジェクトのコピーのみ）
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等性: 同名オブジェクトは上書き。途中失敗しても再実行で追従可能
#   - 並列コピー: -m により高速化
#
# オプション（環境変数で制御・必要に応じて設定）:
#   DRY_RUN=true     : 実際にはコピーせず、対象件数とサイズの見積もりのみを表示
#   EXTRA_CP_FLAGS   : gcloud storage cp に渡す追加フラグ（例: "--checksum" など）
#
# ------------------------------------------------------------------------------
# 🧩 トラブルシュート:
#   ❌ AccessDeniedException / 403
#     → IAM 権限不足。少なくとも source: storage.objects.get / dest: storage.objects.create が必要。
#
#   ❌ Requester Pays が有効なバケット
#     → 課金プロジェクト指定が必要。環境変数 CLOUDSDK_CORE_PROJECT を適切な課金プロジェクトに。
#
#   ❌ NotFound: 指定プレフィックスにオブジェクトが存在しない
#     → SRC_PREFIX の綴り・末尾スラッシュに注意（例: logs/ と logs は別扱いになり得る運用も）
#
#   ⏳ 遅い/タイムアウト
#     → ネットワークや大容量時は再実行。EXTRA_CP_FLAGS に --no-clobber を付けないこと（上書き前提）
# ------------------------------------------------------------------------------

set -euo pipefail

SRC_BUCKET="${1:-}"
SRC_PREFIX_INPUT="${2:-}"
DST_BUCKET="${3:-}"
DST_PREFIX_INPUT="${4:-}"

if [[ -z "${SRC_BUCKET}" || -z "${SRC_PREFIX_INPUT}" || -z "${DST_BUCKET}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <SRC_BUCKET> <SRC_PREFIX> <DST_BUCKET> [DST_PREFIX]"
  exit 1
fi

# 末尾の余計なスラッシュを1つに正規化（空を許容しない設計）
SRC_PREFIX="${SRC_PREFIX_INPUT%/}/"
DST_PREFIX="${DST_PREFIX_INPUT:-$SRC_PREFIX}"
DST_PREFIX="${DST_PREFIX%/}/"

DRY_RUN="${DRY_RUN:-false}"
EXTRA_CP_FLAGS="${EXTRA_CP_FLAGS:-}"

echo "▶️  SRC_BUCKET : ${SRC_BUCKET}"
echo "▶️  SRC_PREFIX : ${SRC_PREFIX}"
echo "▶️  DST_BUCKET : ${DST_BUCKET}"
echo "▶️  DST_PREFIX : ${DST_PREFIX}"
echo "▶️  DRY_RUN    : ${DRY_RUN}"
[[ -n "${EXTRA_CP_FLAGS}" ]] && echo "▶️  EXTRA_CP_FLAGS : ${EXTRA_CP_FLAGS}"
echo "────────────────────────────────────────────────────────"

SRC_URI="gs://${SRC_BUCKET}/${SRC_PREFIX}"
DST_URI="gs://${DST_BUCKET}/${DST_PREFIX}"

# --- ヘルパー: バケット存在チェック -------------------------------------------
bucket_exists () {
  local bucket="$1"
  if ! gcloud storage buckets describe "gs://${bucket}" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

# --- ヘルパー: 件数と合計サイズを取得 -----------------------------------------
# 引数: <URI prefix>（例: gs://bucket/path/）
# 出力: 2行（count と bytes）
stat_prefix () {
  local uri_prefix="$1"
  # --recursive --long で全オブジェクトとサイズを取得
  # フォルダ見出し等は出ない想定。サイズ列（先頭）が整数の行のみ集計。
  local tmp
  if ! tmp="$(gcloud storage ls --recursive --long "${uri_prefix}" 2>/dev/null || true)"; then
    echo "0"; echo "0"; return
  fi

  # "TOTAL:      N objects, M bytes" が末尾に出る場合もあるが、行頭サイズ列の行で集計する
  local count bytes
  count="$(awk '/^[[:space:]]*[0-9]+[[:space:]]+[0-9]{4}-/{c++} END{print c+0}' <<<"${tmp}")"
  bytes="$(awk '
    /^[[:space:]]*[0-9]+[[:space:]]+[0-9]{4}-/ {sum += $1}
    END {printf "%.0f\n", sum+0}
  ' <<<"${tmp}")"

  echo "${count:-0}"
  echo "${bytes:-0}"
}

# --- ヘルパー: バイト値を人間可読に -------------------------------------------
human_bytes () {
  local bytes="$1"
  # numfmt があれば使う
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B --format="%.2f" "${bytes}" 2>/dev/null || echo "${bytes}B"
  else
    # awk 簡易版（IEC）
    awk -v b="${bytes}" '
      function fmt(x, u) {
        if (x<1024) return sprintf("%.0fB", x);
        s="KMGTPEZY";i=0;
        while (x>=1024 && i<length(s)) {x/=1024;i++}
        return sprintf("%.2f%siB", x, substr(s,i,1));
      }
      BEGIN {print fmt(b)}
    '
  fi
}

# --- 0) バケット存在チェック ---------------------------------------------------
echo "🔎 Checking buckets…"
if ! bucket_exists "${SRC_BUCKET}"; then
  echo "❌ ソースバケット 'gs://${SRC_BUCKET}' が見つかりません。"
  exit 1
fi
if ! bucket_exists "${DST_BUCKET}"; then
  echo "❌ デスティネーションバケット 'gs://${DST_BUCKET}' が見つかりません。"
  exit 1
fi

# --- 1) ソースの存在チェック ---------------------------------------------------
echo "🔎 Scanning source prefix…"
read -r SRC_COUNT SRC_BYTES < <(stat_prefix "${SRC_URI}")
if [[ "${SRC_COUNT}" -eq 0 ]]; then
  echo "⚠️  ソースに該当オブジェクトが見つかりません: ${SRC_URI}"
  exit 0
fi

SRC_BYTES_HUMAN="$(human_bytes "${SRC_BYTES}")"
echo "📦 Source objects : ${SRC_COUNT} objects, ${SRC_BYTES_HUMAN}"

# --- 2) コピー実行（DRY_RUN でスキップ可） ------------------------------------
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "🔎 DRY RUN のためコピーは実行しません。実行予定コマンド:"
  echo "    gcloud storage cp -r -m \"${EXTRA_CP_FLAGS}\" \"${SRC_URI}**\" \"${DST_URI}\""
else
  echo "🚚 Copying… (overwrite, recursive, parallel)"
  # 上書き前提: --no-clobber は付けないこと
  # 注意: 末尾 '**' で SRC_PREFIX 配下すべてを再帰コピー
  gcloud storage cp -r -m "${EXTRA_CP_FLAGS}" "${SRC_URI}**" "${DST_URI}"
fi

# --- 3) 転送後のレポート -------------------------------------------------------
echo "🔎 Gathering post-copy stats…"
read -r DST_COUNT DST_BYTES < <(stat_prefix "${DST_URI}")

DST_BYTES_HUMAN="$(human_bytes "${DST_BYTES}")"

# 差分（コピー先で増えた「当該プレフィックス配下」総量の目安）
# ※完全一致判定ではないが、一般的な検収用途に十分
echo "────────────────────────────────────────────────────────"
echo "🧾 Transfer Report"
echo "  FROM: ${SRC_URI}"
echo "    - objects : ${SRC_COUNT}"
echo "    - size    : ${SRC_BYTES_HUMAN}"
echo "  TO  : ${DST_URI}"
echo "    - objects : ${DST_COUNT}"
echo "    - size    : ${DST_BYTES_HUMAN}"

# 参考: コピー直後の「差異ヒント」
DIFF_OBJS=$(( DST_COUNT - 0 ))  # 単純表示用
DIFF_BYTES=$(( DST_BYTES - 0 ))
DIFF_BYTES_HUMAN="$(human_bytes "${DIFF_BYTES}")"

echo "────────────────────────────────────────────────────────"
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "ℹ️  DRY RUN のため、上記はコピー前の見積もり（Source のみ）です。"
else
  # 転送検証（ソース件数とコピー先件数が一致しているかの簡易チェック）
  if [[ "${DST_COUNT}" -lt "${SRC_COUNT}" ]]; then
    echo "⚠️  注意: コピー先の件数がソースより少ない可能性があります。再実行や権限・エラーを確認してください。"
  else
    echo "✅  基本チェック: コピー先で十分な件数が確認できました。"
  fi
fi

# --- 4) 参考コマンド -----------------------------------------------------------
echo ""
echo "🔎 参考コマンド:"
echo "  # 差分候補（コピー漏れ/上書き失敗などの確認）"
echo "  gcloud storage ls --recursive --long \"${SRC_URI}\" > /tmp/src.list"
echo "  gcloud storage ls --recursive --long \"${DST_URI}\" > /tmp/dst.list"
echo "  # オブジェクト名リスト比較（サイズも見る場合は適宜加工）"
echo "  awk '{print \$NF}' /tmp/src.list | sort > /tmp/src.names"
echo "  awk '{print \$NF}' /tmp/dst.list | sort > /tmp/dst.names"
echo "  comm -23 /tmp/src.names /tmp/dst.names | head"
echo ""

# --- 5) メモ -------------------------------------------------------------------
cat <<'MEMO'
📝 メモ:
- このスクリプトは「上書きコピー」が前提です（--no-clobber は使用しません）。
- プレフィックスは最後に "/" を付けたフォルダ風パスで扱います。
  例: logs/2025/ の配下すべてが対象（logs/2025/**）。
- 転送は冪等です。失敗時は同じコマンドで再実行してください（成功済みは上書きされるだけ）。
- 大量オブジェクトの場合、一覧取得や集計に時間がかかることがあります。
  必要に応じて DRY_RUN=true で事前見積りを行ってください。
- バケット間コピーにおいて、リージョン/デュアルリージョン差異やストレージクラス差異がある場合、
  課金額が変わります。必要なら EXTRA_CP_FLAGS で --storage-class=Nearline 等を指定してください。
MEMO
