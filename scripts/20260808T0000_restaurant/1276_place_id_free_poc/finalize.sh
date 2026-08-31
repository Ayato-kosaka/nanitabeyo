#!/usr/bin/env bash
# PoC の最終成果物を作る。
#
# probe は済んでいる前提で、キャッシュから ①②③ と提出用 CSV を作り直す。
# Google への問い合わせは adjudicate だけが行い、それも無料SKU
# （Text Search IDs Only / Place Details IDs Only）に限られる。
#
# cache/probe_all.sqlite は消さない。①②③ の測定に使った probe が全部入っており、
# 作り直すには数万リクエストが要る。以前ここで `rm -f` してから別キャッシュの併合で
# 作り直していたが、いまはこれが唯一の正本である。
set -euo pipefail
cd "$(dirname "$0")"

RULE=box_unique
CACHE=cache/probe_all.sqlite
mkdir -p results out

echo "=== ラベルの突合と不一致の裁定（無料SKUのみ） ==="
python3 evaluate_labels.py \
  --labels out/labels_union.csv --seeds out/seeds_labeled_6000.csv \
  --cache "$CACHE" --rules "$RULE" \
  --mismatches-output out/mismatch_6000.csv \
  --output results/eval_labels_6000.json > /dev/null
python3 adjudicate.py \
  --mismatches out/mismatch_6000.csv \
  --seeds out/seeds_labeled_6000.csv \
  --output results/adjudication_6000.json | tail -12

echo
echo "=== ①②③ ==="
python3 kpi.py \
  --cache "$CACHE" --rule "$RULE" \
  --sample out/sample_merged5_probed.csv \
  --labels out/labels_union.csv \
  --label-seeds out/seeds_labeled_6000.csv \
  --adjudication results/adjudication_6000.csv \
  --google-pairs out/google_pairs_all.json \
  --google-seeds out/seeds_google_blocks.csv \
  --output results/kpi.json > /dev/null
python3 - <<'PY'
import json
d = json.load(open("results/kpi.json"))
one = d["kpi1_resolve_rate"]
print(f"  ① 名寄せ確定率  {one['matched']:,}/{one['denominator']:,} = {one['rate']:.2%} "
      f"(95%CI {one['ci95'][0]:.2%}–{one['ci95'][1]:.2%})")
for name, bucket in d["kpi2_precision"].items():
    print(f"  ② 正解率 [{name}] 確定 {bucket['matched']:,} 生の不一致 {bucket['raw_disagreements']} "
          f"裁定後の誤り {bucket['errors_after_adjudication']} = {bucket['precision']:.5%} "
          f"(下限 {bucket['precision_95_lower']:.5%})")
three = d.get("kpi3_google_reach")
if three:
    print(f"  ③ Google 側の到達率 {three['reached']:,}/{three['enumerated_google_places']:,} "
          f"= {three['rate']:.2%} (95%CI {three['ci95'][0]:.2%}–{three['ci95'][1]:.2%})")
PY

echo
echo "=== 提出用 CSV ==="
python3 place_id_poc.py export \
  --seeds out/sample_merged5_probed.csv out/seeds_labeled_6000.csv \
          out/sample_3sources_3000.csv out/seeds_google_blocks.csv \
          out/sample_ifas_labeled_2000.csv \
  --cache "$CACHE" --rule "$RULE" \
  --output results/matched_place_ids.csv

echo
echo "=== キャッシュを CSV に落とす（再現用） ==="
python3 cache_io.py dump --cache "$CACHE" --output results/probe_cache.csv.gz
