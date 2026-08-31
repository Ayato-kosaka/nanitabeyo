#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
4_1_generate_variants.py

【目的】
BigQuery の dish_category_catalog から variants を生成し、
dish_category_variant_catalog に格納する。

【処理内容】
1. dish_category_catalog から label_en, labels_json を取得
2. variants を正規化・重複排除して生成
   - generate_variants.py のロジックを BigQuery データに適用
   - canonical 優先
   - 日本語は kata2hira, romaji 派生を生成
   - グローバル一意化（canonical優先 → 検索到達可能性 → source priority → QID番号）
3. dish_category_variant_catalog にロード（CREATE OR REPLACE）

【使用方法】
python3 4_1_generate_variants.py

【注意】
- Wikidata への新規アクセスは行わない
- 既存の dish_category_catalog データのみを使用
- テーブルは CREATE OR REPLACE で再生成される
- generate_variants.py の設計思想に従う（4 sources のみ、alias 除外）

【#1748 表記が衝突したときに «検索に出ない QID» を勝たせない】
1 つの表記は 1 つの QID しか持てない。従来の競合解決は QID 番号の小さい方を採っていたが、
Q 番号は Wikidata の登録順でしかなく、どちらが利用者の言う語かとは無関係である。
その結果 **利用者が入力できるのに検索が決して要求しない QID** が生まれていた。

実害（オーナー実機 2026-08-31）: 表記「焼肉」を Q844466（広東料理の焼豚 siu yuk）が取り、
検索が要求する Q2431975（yakiniku）には日本語の「焼肉」が 1 件も無くなっていた。
取り込み時に付くのは Q844466、検索が要求するのは Q2431975 で、
`findDishMediaIds` は category_id の完全一致なので **永久にヒットしない**。
同じ形が「かき氷」「餃子」でも起きていた。

そこで **dish_category_features_catalog に居るか（＝レコメンド／検索が要求しうるか）** を
競合解決の最上位キーにする。Q 番号による決定は最後の tie-break へ落とす。

⚠️ canonical と非 canonical の優先順位は変えていない。canonical-label-en はその項目自身の
   英語名なので、日本語ラベルに奪わせると英語検索が壊れる。
"""

import sys
import json
import logging
import unicodedata
from datetime import datetime, timezone
from typing import List, Dict, Set, Tuple
from pathlib import Path
from collections import defaultdict
from google.cloud import bigquery

# 日本語処理用ライブラリ（必須）
import jaconv
from pykakasi import kakasi

_kks = kakasi()

# プロジェクトルートのモジュールをインポート
sys.path.append(str(Path(__file__).parent))
from loader_bigquery import BigQueryLoader

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 固定値
GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"


def norm_key(s: str) -> str:
    """
    文字列を正規化（NFKC → 空白圧縮 → 小文字化）
    
    Args:
        s: 正規化する文字列
    
    Returns:
        正規化された文字列
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = " ".join(s.split())
    return s.lower()


def is_bad(s: str) -> bool:
    """
    空または無意味な文字列かどうかを判定
    
    Args:
        s: 判定する文字列
    
    Returns:
        True: 空または無意味, False: 有効
    """
    return (not s) or (s == "") or (s in {"null", "\\n", "\\N"})


def qid_num(qid: str) -> int:
    """
    QID から数値を抽出（競合解決用）
    
    Args:
        qid: Wikidata QID (例: "Q12345")
    
    Returns:
        QID の数値部分、抽出失敗時は大きな数値
    """
    try:
        return int(qid.rsplit("Q", 1)[1])
    except Exception:
        return 10**12


def to_romaji(text: str) -> str:
    """
    日本語をローマ字に変換
    
    Args:
        text: 日本語テキスト
    
    Returns:
        ローマ字変換結果
    """
    parts = _kks.convert(text)
    return "".join(p.get("hepburn", "") for p in parts).replace(" ", "")


def fetch_searchable_qids(loader) -> Set[str]:
    """
    #1748 «検索／レコメンドが要求しうる» 料理カテゴリの QID を返す。

    レコメンドの候補集合は dish_category_features_catalog に特徴量を持つ QID だけで、
    検索画面はそこから選ばれた categoryId しか API へ渡さない。つまりこの集合の外の QID は
    **利用者が取り込み時に選べても、検索からは決して要求されない**。
    表記が衝突したときは、この集合に居る側へ表記を渡さなければならない。

    Args:
        loader: BigQueryLoader

    Returns:
        QID の集合。取得に失敗したら例外を送出する（黙って空集合にしない。
        空集合で続行すると «全部が検索に出ない» 扱いになり、従来と同じ競合解決へ
        静かに戻ってしまい、直したはずの表記がまた奪われる）
    """
    query = f"""
        SELECT DISTINCT item_qid
        FROM `{loader.dataset_ref}.dish_category_features_catalog`
        WHERE item_qid IS NOT NULL
    """
    rows = list(loader.client.query(query).result())
    qids = {r.item_qid for r in rows}
    if not qids:
        raise RuntimeError(
            "dish_category_features_catalog が空です。"
            "この集合が無いと «検索に出る QID» を優先できないため中断します。"
        )
    logger.info(f"Searchable QIDs (from dish_category_features_catalog): {len(qids)}")
    return qids


def fetch_existing_variant_winners(loader) -> Dict[str, str]:
    """
    #1748 置換前の dish_category_variant_catalog を surface_form -> QID で読む。

    このスクリプトは DROP & CREATE でテーブルを丸ごと置き換えるため dry-run が無い。
    代わりに «どの表記の勝者が入れ替わったか» を実行ログへ出せるようにする。
    これが無いと、流した後に «意図した 3 件だけが動いたのか、無関係な大量入れ替えが
    起きたのか» を後から判定できない。

    Args:
        loader: BigQueryLoader

    Returns:
        surface_form -> dish_category_id。テーブルが無ければ空の辞書
    """
    query = f"""
        SELECT surface_form, dish_category_id
        FROM `{loader.dataset_ref}.dish_category_variant_catalog`
    """
    try:
        rows = list(loader.client.query(query).result())
    except Exception as e:
        # 初回実行などでテーブルが無い場合。diff が出せないだけで生成自体は続行してよい
        logger.warning(f"Could not read existing variant catalog (skipping diff): {e}")
        return {}
    return {r.surface_form: r.dish_category_id for r in rows}


def log_winner_diff(before: Dict[str, str], final_variants: List[Dict]) -> None:
    """
    #1748 置換前後で «勝者 QID が変わった表記» を実行ログへ出す。

    Args:
        before: 置換前の surface_form -> QID
        final_variants: これから書き込む variants
    """
    if not before:
        logger.info("No previous variant catalog to diff against")
        return

    after = {v["surface_form"]: v["dish_category_id"] for v in final_variants}
    changed = sorted(
        (surf, before[surf], after[surf])
        for surf in set(before) & set(after)
        if before[surf] != after[surf]
    )
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))

    logger.info(
        f"Winner diff - changed: {len(changed)}, added: {len(added)}, removed: {len(removed)}"
    )
    # 全件出す。ここを打ち切ると «意図した入れ替えだけか» を確認できなくなる
    for surf, old_qid, new_qid in changed:
        logger.info(f"  [CHANGED] '{surf}': {old_qid} -> {new_qid}")
    for surf in added[:50]:
        logger.info(f"  [ADDED] '{surf}' -> {after[surf]}")
    if len(added) > 50:
        logger.info(f"  [ADDED] ... and {len(added) - 50} more")
    for surf in removed[:50]:
        logger.info(f"  [REMOVED] '{surf}' (was {before[surf]})")
    if len(removed) > 50:
        logger.info(f"  [REMOVED] ... and {len(removed) - 50} more")


def resolve_winners(
    all_candidates: List[Dict],
    source_priority: Dict[str, int],
    searchable_qids: Set[str],
) -> Tuple[Dict[str, int], int]:
    """
    表記ごとの勝者を 1 つに決める（グローバル一意化）。

    優先順位は上から順に:
      1. canonical であること（canonical-label-en。その項目自身の英語名）
      2. **#1748 検索／レコメンドが要求しうる QID であること**
      3. source priority
      4. QID 番号

    【なぜ 2 が要るのか】
    従来は 3 と 4 だけだった。同じ source で衝突したとき（例: 日本語ラベル同士は
    どちらも `wikidata-label`）Q 番号だけで決まり、**利用者が入力できるのに検索が
    決して要求しない QID** が表記を奪っていた。実際に表記「焼肉」を
    Q844466（広東料理の焼豚 siu yuk）が取り、検索が要求する Q2431975（yakiniku）には
    日本語の「焼肉」が 1 件も無くなっていた。`findDishMediaIds` は category_id の
    完全一致なので、そのカテゴリで保存された投稿は永久に検索へ出ない。

    【なぜ 1 を 2 より上に置いたままなのか】
    canonical-label-en はその項目自身の英語名である。日本語ラベルに奪わせると、
    その語での英語検索が別の料理へ着地する。今回直したい衝突は 3 件とも
    非 canonical 同士なので、canonical の優先を崩す必要が無い。

    Args:
        all_candidates: [{"qid", "surface", "source", "canonical"}] のリスト
        source_priority: source 名 -> 優先度（小さいほど強い）
        searchable_qids: 検索／レコメンドが要求しうる QID の集合

    Returns:
        (surface -> all_candidates の添字, 衝突で捨てた候補の数)
    """
    def not_searchable(idx: int) -> int:
        """検索に出るなら 0、出ないなら 1。min() は小さい方を選ぶので «出る» が勝つ"""
        return 0 if all_candidates[idx]["qid"] in searchable_qids else 1

    winners: Dict[str, int] = {}

    # まず canonical を確定（衝突したら 検索到達可能性 → qid_num の順で採用）
    for i, c in enumerate(all_candidates):
        if not c["canonical"]:
            continue

        surf = c["surface"]
        if surf not in winners:
            winners[surf] = i
            continue

        # winners には canonical しか入っていない段階なので canonical 同士の比較になる
        cur_idx = winners[surf]
        if (not_searchable(i), qid_num(c["qid"])) < (
            not_searchable(cur_idx),
            qid_num(all_candidates[cur_idx]["qid"]),
        ):
            winners[surf] = i

    # 非 canonical を surface ごとにグループ化
    by_surface = defaultdict(list)
    for i, c in enumerate(all_candidates):
        if not c["canonical"]:
            by_surface[c["surface"]].append(i)

    def rank(idx: int):
        """競合解決用のランク付け（検索到達可能性 → source priority → QID 番号）"""
        c = all_candidates[idx]
        return (not_searchable(idx), source_priority.get(c["source"], 9), qid_num(c["qid"]))

    collide_skipped = 0
    for surf, idxs in by_surface.items():
        if surf in winners:
            # canonical が既に確定しているので全てスキップ
            collide_skipped += len(idxs)
            continue
        winners[surf] = min(idxs, key=rank)
        collide_skipped += (len(idxs) - 1)

    return winners, collide_skipped


def extract_variants_from_json(
    item_qid: str,
    label_en: str,
    labels_json: str
) -> List[Dict]:
    """
    JSON から variants を抽出
    generate_variants.py のロジックを適用（labels のみ、aliases 除外）
    
    Args:
        item_qid: dish_category QID
        label_en: 英語ラベル
        labels_json: 全言語ラベルの JSON 文字列
    
    Returns:
        candidates のリスト [{"qid": ..., "surface": ..., "source": ..., "canonical": bool}, ...]
    """
    candidates = []
    seen_per_qid = set()  # (qid, surface) の重複を防ぐ
    
    def add_candidate(raw: str, source: str, canonical: bool = False):
        """候補を追加（QID内重複抑止）"""
        s = norm_key(raw)
        if is_bad(s):
            return
        key = (item_qid, s)
        if key in seen_per_qid:
            return
        seen_per_qid.add(key)
        candidates.append({
            "qid": item_qid,
            "surface": s,
            "source": source,
            "canonical": canonical
        })
    
    # 1) label_en を canonical として追加
    if label_en and not is_bad(label_en):
        add_candidate(label_en, "canonical-label-en", canonical=True)
    
    # 2) labels_json からラベルを追加（日本語は派生も生成）
    # NOTE: aliases は generate_variants.py で扱っていないため除外
    if labels_json:
        try:
            labels = json.loads(labels_json)
            for lang, label_val in labels.items():
                if isinstance(label_val, str) and not is_bad(label_val):
                    add_candidate(label_val, "wikidata-label")
                    
                    # 日本語の場合は派生形を生成
                    if lang == "ja":
                        hira = jaconv.kata2hira(label_val)
                        add_candidate(hira, "kata2hira")
                        add_candidate(to_romaji(hira), "romaji")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse labels_json for {item_qid}: {e}")
    
    return candidates


def generate_variants(loader: BigQueryLoader) -> None:
    """
    dish_category_catalog から variants を生成し、
    dish_category_variant_catalog に格納
    generate_variants.py のロジックを適用（canonical優先、グローバル一意化）
    
    Args:
        loader: BigQueryLoader インスタンス
    """
    logger.info("=" * 80)
    logger.info("Generating variants from dish_category_catalog")
    logger.info("=" * 80)
    
    # 1) dish_category_catalog からデータ取得
    # NOTE: aliases_json は取得せず、labels のみを使用（generate_variants.py に準拠）
    query = f"""
        SELECT
            item_qid,
            label_en,
            labels_json
        FROM `{loader.dataset_ref}.dish_category_catalog`
        WHERE item_qid IS NOT NULL
    """
    
    logger.info("Fetching dish_category_catalog data...")
    job = loader.client.query(query)
    rows = list(job.result())
    logger.info(f"Fetched {len(rows)} categories")

    # #1748 このスクリプトは DROP & CREATE なので dry-run が無い。
    # 置換前を読んでおき、あとで «勝者が入れ替わった表記» をログへ出せるようにする
    before_winners = fetch_existing_variant_winners(loader)
    
    # 2) 全カテゴリから candidates を生成
    all_candidates = []
    stats = {
        "total_categories": len(rows),
        "total_candidates": 0,
        "skipped_empty": 0
    }
    
    for row in rows:
        item_qid = row.item_qid
        label_en = row.label_en or ""
        labels_json = row.labels_json or ""
        
        candidates = extract_variants_from_json(
            item_qid, label_en, labels_json
        )
        
        all_candidates.extend(candidates)
        stats["total_candidates"] += len(candidates)
    
    logger.info(f"Generated {stats['total_candidates']} candidates from {stats['total_categories']} categories")
    
    # 3) グローバル一意化（canonical 優先 → 非canonicalは競合解決）
    # generate_variants.py の source_priority に厳密に従う（4 sources のみ）
    source_priority = {
        "wikidata-label": 0,
        "kata2hira": 1,
        "romaji": 2,
        "canonical-label-en": -1
    }
    
    # #1748 «検索／レコメンドが要求しうる QID» を競合解決の最上位キーにする。
    # 詳細は resolve_winners の docstring を参照
    searchable_qids = fetch_searchable_qids(loader)

    winners, collide_skipped = resolve_winners(
        all_candidates, source_priority, searchable_qids
    )

    logger.info(f"Global deduplication - kept: {len(winners)}, collide_skipped: {collide_skipped}")
    
    # 4) 出力用データ準備
    final_variants = []
    for surf, idx in winners.items():
        c = all_candidates[idx]
        # 念のため最終防衛（空が紛れていたら捨てる）
        if is_bad(c["surface"]):
            continue
        final_variants.append({
            "dish_category_id": c["qid"],
            "surface_form": c["surface"],
            "source": c["source"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    logger.info(f"Final variants: {len(final_variants)}")

    # #1748 置換前後の勝者の差分をログへ出す（実行後の検証用）
    log_winner_diff(before_winners, final_variants)
    
    # 5) dish_category_variant_catalog に格納（CREATE OR REPLACE）
    if not final_variants:
        logger.warning("No variants to load")
        return
    
    table_id = f"{loader.dataset_ref}.dish_category_variant_catalog"
    logger.info(f"Loading {len(final_variants)} variants to {table_id}")
    
    # まず既存テーブルを削除して再作成
    delete_sql = f"DROP TABLE IF EXISTS `{table_id}`"
    loader.execute_sql(delete_sql)
    
    # テーブル作成
    create_sql = f"""
        CREATE TABLE `{table_id}` (
            dish_category_id STRING NOT NULL,
            surface_form     STRING NOT NULL,
            source           STRING NOT NULL,
            created_at       TIMESTAMP NOT NULL
        )
    """
    loader.execute_sql(create_sql)
    
    # データ挿入
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=[
            {"name": "dish_category_id", "type": "STRING", "mode": "REQUIRED"},
            {"name": "surface_form", "type": "STRING", "mode": "REQUIRED"},
            {"name": "source", "type": "STRING", "mode": "REQUIRED"},
            {"name": "created_at", "type": "TIMESTAMP", "mode": "REQUIRED"},
        ]
    )
    
    job = loader.client.load_table_from_json(
        final_variants,
        table_id,
        job_config=job_config
    )
    job.result()
    
    logger.info(f"✅ Loaded {len(final_variants)} variants to {table_id}")


def main():
    """メイン処理"""
    logger.info("=" * 80)
    logger.info("BigQuery Variants Generation Script")
    logger.info("=" * 80)
    logger.info(f"Project: {GCP_PROJECT}, Dataset: {BQ_DATASET}")
    
    # BigQuery Loader 初期化
    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)
    
    try:
        # variants 生成
        generate_variants(loader)
        
        logger.info("=" * 80)
        logger.info("✅ Variants generation completed successfully")
        logger.info("=" * 80)
    except Exception as e:
        logger.error(f"❌ Error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
