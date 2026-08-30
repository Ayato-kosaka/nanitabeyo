#!/usr/bin/env bash
# 1日上限（Text Search 75,000/日）で中断した分を、上限回復後に取り切る。
#
# 使い捨ての実行環境でも再開できるよう、必要な入力は results/ に圧縮して置いてある。
# Overture の parquet や IFAS の CSV を取り直す必要はない。
#
#   export PLACE_API_TEST=<APIキー>
#   ./resume.sh
#
# 残っているのは2つ。
#   ① OSM 由来の行を含む3ソース比例標本での確定率（未取得 330 seed ≒ 1,320 リクエスト）
#   ② IFAS ラベルでの正解検証（未取得 約1,990 seed ≒ 7,960 リクエスト）
# 合計 1万リクエスト弱で、1日の上限に十分収まる。
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out cache results

echo "=== 入力を展開する ==="
for name in sample_3sources_3000 sample_ifas_labeled_2000 sample_merged_3000 \
            seeds_labeled_4000 seeds_v3_2500 labels_merged_all labels_strict; do
  [ -f "out/$name.csv" ] || gunzip -c "results/inputs/$name.csv.gz" > "out/$name.csv"
done
[ -f cache/probe_all.sqlite ] || python3 cache_io.py load \
  --archive results/probe_cache.csv.gz --cache cache/probe_all.sqlite

echo "=== 残りを取得する（無料SKUのみ） ==="
python3 place_id_poc.py probe \
  --seeds out/sample_3sources_3000.csv out/sample_ifas_labeled_2000.csv \
  --cache cache/probe_all.sqlite \
  --workers 8 --qps 8 --tight-box --wide-box --skip-nearby \
  --only-probes a b c_tight c_wide --execute

echo "=== ① 3ソースでの確定率 ==="
python3 kpi.py --cache cache/probe_all.sqlite --rule box_unique_strict \
  --sample out/sample_merged5_probed.csv --output results/kpi.json

echo "=== ② IFAS ラベルでの正解検証 ==="
python3 evaluate_labels.py --labels out/labels_merged_all.csv \
  --seeds out/sample_ifas_labeled_2000.csv --cache cache/probe_all.sqlite \
  --rules box_unique --mismatches-output out/mismatch_ifas.csv \
  --output results/eval_labels_ifas.json

echo "=== 不一致の裁定 ==="
if [ "$(wc -l < out/mismatch_ifas.csv)" -gt 1 ]; then
  python3 adjudicate.py --mismatches out/mismatch_ifas.csv \
    --seeds out/sample_ifas_labeled_2000.csv --output results/adjudication_ifas.json
else
  echo "不一致なし"
fi

echo "=== 提出用 CSV を作り直す ==="
python3 place_id_poc.py export \
  --seeds out/seeds_v3_2500.csv out/seeds_labeled_4000.csv \
          out/sample_3sources_3000.csv out/sample_merged_3000.csv \
          out/sample_ifas_labeled_2000.csv \
  --cache cache/probe_all.sqlite --rule box_unique \
  --output results/matched_place_ids.csv

echo "=== キャッシュを保存し直す ==="
python3 cache_io.py dump --cache cache/probe_all.sqlite --output results/probe_cache.csv.gz
