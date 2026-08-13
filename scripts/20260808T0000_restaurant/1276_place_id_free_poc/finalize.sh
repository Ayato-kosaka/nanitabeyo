#!/usr/bin/env bash
# PoC の最終成果物を作る。
#
# probe は済んでいる前提で、キャッシュから ①（確定率）②（正解検証）と
# 提出用 CSV を作り直す。Google への問い合わせは adjudicate だけが行い、
# それも無料SKU（Text Search IDs Only / Place Details IDs Only）に限られる。
set -euo pipefail
cd "$(dirname "$0")"

RULE=box_unique
mkdir -p results out

echo "=== ① 名寄せ確定率（統合コーパスの比例標本） ==="
python3 resolve_rate.py \
  --seeds out/sample_merged_3000.csv \
  --cache cache/probe_merged.sqlite \
  --rule "$RULE" --by-source \
  --output results/resolve_rate_merged.json > /dev/null
python3 - <<'PY'
import json
d = json.load(open("results/resolve_rate_merged.json"))
for name, value in d["resolve_rate"].items():
    if value["denominator"]:
        print(f"  {name:<14} 分母={value['denominator']:>5} 確定={value['matched']:>5} = {value['rate']:.2%}")
for source, rates in d.get("by_source", {}).items():
    wide, everything = rates["in_wide_box"], rates["all"]
    print(f"  [{source}] 全件 {everything['rate']:.2%} / 存在しうる行 {wide['rate']:.2%}")
PY

echo
echo "=== ② 正解検証（Overture ラベル） ==="
python3 evaluate_labels.py \
  --labels out/labels_strict.csv --seeds out/seeds_labeled_4000.csv \
  --cache cache/probe_lab.sqlite --rules "$RULE" \
  --mismatches-output out/mismatch_overture.csv \
  --output results/eval_labels_overture.json > /dev/null

echo "=== ② 正解検証（IFAS ラベル） ==="
python3 evaluate_labels.py \
  --labels out/labels_merged_all.csv --seeds out/sample_ifas_labeled_2000.csv \
  --cache cache/probe_merged.sqlite --rules "$RULE" \
  --mismatches-output out/mismatch_ifas.csv \
  --output results/eval_labels_ifas.json > /dev/null
python3 - <<'PY'
import json
for label, path in (("Overture", "results/eval_labels_overture.json"),
                    ("IFAS", "results/eval_labels_ifas.json")):
    d = json.load(open(path))
    r = d["rules"]["box_unique"]
    print(f"  [{label}] ラベル {d['labelled_seeds']} 確定 {r['matched']} "
          f"({r['match_rate']:.2%}) 一致 {r['correct']} 不一致 {r['wrong']} "
          f"precision {r['precision']:.5f} 下限 {r['precision_95_lower']:.5f}")
PY

echo
echo "=== 不一致の裁定（無料SKUのみ） ==="
head -1 out/mismatch_overture.csv > out/mismatch_all.csv
tail -n +2 -q out/mismatch_overture.csv out/mismatch_ifas.csv >> out/mismatch_all.csv
cat out/seeds_labeled_4000.csv > out/seeds_for_adjudication.csv
tail -n +2 out/sample_ifas_labeled_2000.csv >> out/seeds_for_adjudication.csv
python3 adjudicate.py \
  --mismatches out/mismatch_all.csv \
  --seeds out/seeds_for_adjudication.csv \
  --output results/adjudication.json

echo
echo "=== 提出用 CSV ==="
rm -f cache/probe_all.sqlite
python3 merge_caches.py \
  --inputs cache/probe_v3.sqlite cache/probe_lab.sqlite cache/probe_merged.sqlite \
  --output cache/probe_all.sqlite
python3 place_id_poc.py export \
  --seeds out/seeds_v3_2500.csv out/seeds_labeled_4000.csv \
          out/sample_merged_3000.csv out/sample_ifas_labeled_2000.csv \
  --cache cache/probe_all.sqlite --rule "$RULE" \
  --output results/matched_place_ids.csv
