#!/bin/bash
# #581 【設計】実装検証スクリプト
# 
# このスクリプトは実装の健全性を検証します（実際のAPI呼び出しは行いません）

set -e

echo "=========================================="
echo "581 relevance_scoring 実装検証"
echo "=========================================="
echo ""

# カレントディレクトリ確認
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "1. ディレクトリ構造確認..."
for dir in lib prompts sql; do
  if [ -d "$dir" ]; then
    echo "  ✓ $dir ディレクトリが存在します"
  else
    echo "  ✗ $dir ディレクトリが見つかりません"
    exit 1
  fi
done

echo ""
echo "2. 必須ファイル確認..."
files=(
  "config.yml"
  "README.md"
  "1_1_export_input.py"
  "1_2_build_payload_phase1.py"
  "1_3_submit_batch_phase1.py"
  "1_3_poll_batch_phase1.py"
  "1_4_load_results_phase1.py"
  "2_1_build_payload_phase2.py"
  "2_2_submit_batch_phase2.py"
  "2_2_poll_batch_phase2.py"
  "2_3_load_results_phase2.py"
  "3_1_publish_features.py"
  "lib/__init__.py"
  "lib/bq.py"
  "lib/batch_api.py"
  "lib/io.py"
  "lib/metrics.py"
  "prompts/__init__.py"
  "prompts/jp_relevance_scoring_phase1.py"
  "prompts/jp_relevance_scoring_phase2.py"
  "sql/export_input.sql"
  "sql/publish_features.sql"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file が見つかりません"
    exit 1
  fi
done

echo ""
echo "3. Python構文チェック..."
for pyfile in *.py prompts/*.py lib/*.py; do
  if [ -f "$pyfile" ]; then
    python3 -m py_compile "$pyfile" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "  ✓ $pyfile"
    else
      echo "  ✗ $pyfile に構文エラーがあります"
      exit 1
    fi
  fi
done

echo ""
echo "4. config.yml 構文チェック..."
python3 -c "import yaml; yaml.safe_load(open('config.yml'))" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "  ✓ config.yml は有効なYAMLです"
else
  echo "  ✗ config.yml に構文エラーがあります"
  exit 1
fi

echo ""
echo "5. 必須config項目チェック..."
required_keys=(
  "dataset"
  "task"
  "run_id_prefix"
  "final_run_id"
  "model"
  "batch_api"
  "batch_poll_interval_sec"
  "batch_size"
  "features"
)

for key in "${required_keys[@]}"; do
  python3 -c "import yaml; config = yaml.safe_load(open('config.yml')); assert '$key' in config" 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "  ✓ $key"
  else
    echo "  ✗ $key が config.yml に見つかりません"
    exit 1
  fi
done

echo ""
echo "6. feature定義チェック..."
feature_types=("timeSlot" "scene" "appetite" "taste")
for ft in "${feature_types[@]}"; do
  python3 -c "import yaml; config = yaml.safe_load(open('config.yml')); assert '$ft' in config['features']" 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "  ✓ $ft"
  else
    echo "  ✗ $ft が config.yml の features に見つかりません"
    exit 1
  fi
done

echo ""
echo "7. SQL構文簡易チェック..."
for sqlfile in sql/*.sql; do
  if [ -f "$sqlfile" ]; then
    # 基本的なSQL構文チェック（SELECT, FROM, WHERE の存在）
    grep -q "SELECT" "$sqlfile" && grep -q "FROM" "$sqlfile"
    if [ $? -eq 0 ]; then
      echo "  ✓ $sqlfile"
    else
      echo "  ✗ $sqlfile に基本的なSQL構文が見つかりません"
      exit 1
    fi
  fi
done

echo ""
echo "=========================================="
echo "✅ すべての検証に合格しました！"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "1. BigQuery テーブルの作成:"
echo "   cd ../../../infra/big-query/migration"
echo "   # 20251223T0000_create_wikidata_food_llm_feature_scores.sql を実行"
echo ""
echo "2. Phase1 実行:"
echo "   cd 581_relevance_scoring"
echo "   python3 1_1_export_input.py"
echo "   python3 1_2_build_payload_phase1.py"
echo "   python3 1_3_submit_batch_phase1.py"
echo "   python3 1_3_poll_batch_phase1.py"
echo "   python3 1_4_load_results_phase1.py"
echo ""
echo "3. Phase2 実行:"
echo "   python3 2_1_build_payload_phase2.py"
echo "   python3 2_2_submit_batch_phase2.py"
echo "   python3 2_2_poll_batch_phase2.py"
echo "   python3 2_3_load_results_phase2.py"
echo ""
echo "4. 公開:"
echo "   python3 3_1_publish_features.py --dry-run"
echo "   python3 3_1_publish_features.py"
