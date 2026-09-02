#!/usr/bin/env python3
"""#1273 収集ルート1 補完（柱3）: Foursquare OS Places の «店 × Instagram handle» を
既存店（restaurant_catalog）へ空間照合し、店固有 store_branch アカウントとして
sns_source_account へ入れる。

背景:
  ローカルに «Instagram handle を公開している日本の飲食店 ~57,899 件»（Foursquare OS
  Places 由来、座標つき）の CSV がある。これを «その店だけの投稿を出すアカウント» として
  収集元にできれば、後段（harvest → resolve）で **caption の店名照合を一切せず**、handle を
  出した瞬間にその店へ帰属できる（＝誤帰属ゼロの高信頼シード）。ただし当パイプラインは店を
  google_place_id でキーにするため、各 Foursquare venue を restaurant_catalog の 1 行へ
  照合して google_place_id を得る必要がある。

フロー:
  1. CSV を読み、instagram_handle を正規化（小文字化・@/末尾のドット/スラッシュ除去・
     非アカウントパス p/reel/explore 等を除外）。
  2. (fsq_place_id, handle, name, lat, lng) を **staging テーブル** へ load。
  3. venue → catalog の照合を **BigQuery の空間 JOIN で** 実行（重い突き合わせは SQL 側）:
     ST_DWITHIN で --match-radius-m 内の catalog 行を集め、ST_DISTANCE 最小（最寄り）を採る。
  4. 誤って隣店に付かないよう、FSQ 名と catalog 名で «長さ≥2 の CJK bigram / 英数トークンを
     1 つ以上共有» する軽い名前サニティチェックを Python 側で課す（最寄りが通らなければ落とす）。
  5. chain-dedup（4_1 と同一規律）: 同一 handle が 2 店以上の google_place_id に付いたら
     チェーン公式/集約アカウントなので落とし、**1 店だけに付く handle** のみ store_branch にする。
  6. sns_source_account へ store_branch 行として投入
     （discovery_method='foursquare_os_places' / discovery_seed_place_id=google_place_id）。

照合・分類の «単一頭脳» は resolve 側だが、ここは «既に店固有と分かっている handle を、座標で
既存店へ束ねる» 前処理であり、caption 依存の店名照合とは別物（誤帰属しないための設計）。

この出力（store_branch アカウント群）は #1777（Foursquare シードの harvest）が食う。
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import logging
import re
import unicodedata
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_SOURCE_ACCOUNT

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent
DEFAULT_CSV = HERE / "1273_instagram_seed_poc" / "out" / "fsq_jp_dining_instagram.csv"

DISCOVERY_METHOD = "foursquare_os_places"

# Instagram の «アカウントではないパス»。handle として拾ってはいけない。
_NON_ACCOUNT = {
    "p", "reel", "reels", "tv", "explore", "stories", "s", "accounts",
    "about", "developer", "legal", "directory",
}
# 正規化後の handle として許す文字集合（英小文字・数字・アンダースコア・ドット）。
_HANDLE_RE = re.compile(r"^[a-z0-9_.]{1,30}$")
_IG_URL_RE = re.compile(r"instagram\.com/([a-z0-9_.]+)", re.IGNORECASE)

# NFKC 後にトークン抽出するための文字クラス。
_ALNUM_RUN_RE = re.compile(r"[0-9a-z]+")
# ひらがな・カタカナ（長音符含む）・CJK 統合漢字(+拡張A)。
_CJK_RUN_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿]+")


def _normalize_handle(raw: str | None) -> str | None:
    """CSV の instagram_handle を «アカウント名 1 個» に正規化する。

    - URL 形式ならパスの handle だけ取り出す
    - 先頭 @、前後の空白・スラッシュ・ドットを除去し小文字化
    - 非アカウントパス（p/reel/explore 等）と、handle 文字集合外は None
    """
    if not raw:
        return None
    h = raw.strip().lower()
    if "instagram.com/" in h:
        m = _IG_URL_RE.search(h)
        h = m.group(1) if m else ""
    h = h.lstrip("@").strip("/").strip(".")
    if not h or h in _NON_ACCOUNT:
        return None
    if not _HANDLE_RE.match(h):
        return None
    return h


def _name_tokens(name: str | None) -> set[str]:
    """名前サニティチェック用のトークン集合を作る（長さ≥2 のみ）。

    NFKC で全角英数字・半角カナを畳んでから:
      - 英数字の連続 run はその run 全体を 1 トークン（例 'mr_george1981' → 'george1981' 等の run）
      - CJK（かな/漢字）の run は «文字 bigram» を全て（日本語は分かち書きが無いため、
        '沖食堂' → {'沖食','食堂'} のように部分一致を許す）
    どちらかの側の run が 1 文字なら（長さ<2）トークンにしない。
    """
    if not name:
        return set()
    s = unicodedata.normalize("NFKC", name).lower()
    tokens: set[str] = set()
    for run in _ALNUM_RUN_RE.findall(s):
        if len(run) >= 2:
            tokens.add(run)
    for run in _CJK_RUN_RE.findall(s):
        for i in range(len(run) - 1):
            tokens.add(run[i:i + 2])
    return tokens


def _names_share_token(fsq_name: str | None, cat_name: str | None) -> bool:
    """FSQ 名と catalog 名が «長さ≥2 のトークンを 1 つ以上共有» するか。"""
    return bool(_name_tokens(fsq_name) & _name_tokens(cat_name))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Foursquare の店×IG handle を既存店へ空間照合し store_branch を収集する（柱3）"
    )
    p.add_argument("--run-id", default=None)
    p.add_argument("--fsq-csv", default=str(DEFAULT_CSV),
                   help="Foursquare の飲食×Instagram CSV（既定は 1273_instagram_seed_poc/out/…）")
    p.add_argument("--catalog-run-id", default=None,
                   help="照合先 restaurant_catalog の run_id（省略時は最新）")
    p.add_argument("--match-radius-m", type=float, default=80.0,
                   help="venue→catalog 空間照合の半径[m]（既定 80）")
    p.add_argument("--dry-run", action="store_true",
                   help="照合統計だけ算出してログに出す。sns_source_account へは書かない")
    p.add_argument("--limit", type=int, default=None,
                   help="CSV から staging に載せる上限（動作確認用）")
    return p.parse_args()


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    """最新の restaurant_catalog run_id を選ぶ（4_1 / 7_1 と同じ選び方）。"""
    for row in pipeline.execute(
        f"SELECT run_id, COUNT(*) c FROM `{pipeline.table('restaurant_catalog')}` "
        f"GROUP BY run_id ORDER BY c DESC LIMIT 1"
    ):
        return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id がありません。")


def _stage_table_name(run_id: str) -> str:
    """run_id を BigQuery 識別子に使える形へ畳んだ staging テーブル名。

    run_id は '.'/':'/'-' を含み得るが、テーブル識別子はそれらを許さないため置換する。
    """
    safe = re.sub(r"[^A-Za-z0-9_]", "_", run_id)
    return f"sns_fsq_stage_{safe}"


def _resolve_csv_path(csv_path: Path) -> Path:
    """CSV 実体を解決する。CSV は «再現できる中間生成物» として gitignore され CI には無い。
    代わりに gzip 版（out/…csv.gz）をコミットしてあるので、素の .csv が無ければ .gz を使う。
    """
    if csv_path.exists():
        return csv_path
    gz = csv_path.with_suffix(csv_path.suffix + ".gz")
    if gz.exists():
        return gz
    raise FileNotFoundError(f"FSQ CSV が見つかりません: {csv_path} も {gz} も無し")


def _open_text(path: Path):
    """.gz なら透過的に解凍して text stream を返す。"""
    if path.suffix == ".gz":
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", newline="")
    return path.open("r", encoding="utf-8", newline="")


def _read_staging_rows(csv_path: Path, limit: int | None):
    """CSV → staging 行（handle 正規化・座標検証済み）。統計も返す。"""
    n_csv = 0
    n_valid_handle = 0
    rows: list[dict] = []
    with _open_text(_resolve_csv_path(csv_path)) as stream:
        reader = csv.DictReader(stream)
        for rec in reader:
            n_csv += 1
            handle = _normalize_handle(rec.get("instagram_handle"))
            if not handle:
                continue
            n_valid_handle += 1
            try:
                lat = float(rec["latitude"])
                lng = float(rec["longitude"])
            except (TypeError, ValueError, KeyError):
                continue
            rows.append({
                "fsq_place_id": rec.get("fsq_place_id"),
                "handle": handle,
                "name": rec.get("name"),
                "lat": lat,
                "lng": lng,
            })
            if limit and len(rows) >= limit:
                break
    return rows, n_csv, n_valid_handle


def _create_stage_table(pipeline: BigQueryPipeline, stage_name: str) -> None:
    """staging を明示スキーマで作り直す（load_json_rows は既存テーブルへ append するため）。"""
    pipeline.execute(
        f"""
        CREATE OR REPLACE TABLE `{pipeline.table(stage_name)}` (
          fsq_place_id STRING,
          handle STRING,
          name STRING,
          lat FLOAT64,
          lng FLOAT64
        )
        """
    )


def _drop_stage_table(pipeline: BigQueryPipeline, stage_name: str) -> None:
    try:
        pipeline.execute(f"DROP TABLE IF EXISTS `{pipeline.table(stage_name)}`")
    except Exception as error:  # cleanup 失敗で本処理の結果を握り潰さない
        LOGGER.warning("staging テーブル %s の削除に失敗しました: %s", stage_name, error)


def _spatial_match(pipeline: BigQueryPipeline, stage_name: str,
                   catalog_run_id: str, radius_m: float):
    """venue → catalog の最寄り 1 件を BigQuery の空間 JOIN で採る。

    重い突き合わせ（57k venue × catalog）は SQL 側に寄せ、Python へは «各 venue の最寄り
    catalog 1 行 + 両者の名前» だけを返す。名前サニティチェックはこの結果に Python で課す。
    """
    from google.cloud import bigquery

    sql = f"""
      WITH fsq AS (
        SELECT fsq_place_id, handle, name AS fsq_name,
               ST_GEOGPOINT(lng, lat) AS geo
        FROM `{pipeline.table(stage_name)}`
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      ),
      cat AS (
        SELECT google_place_id, name AS cat_name,
               ST_GEOGPOINT(longitude, latitude) AS geo
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @crid
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND google_place_id IS NOT NULL
      ),
      joined AS (
        SELECT
          f.fsq_place_id, f.handle, f.fsq_name,
          c.google_place_id, c.cat_name,
          ST_DISTANCE(f.geo, c.geo) AS dist_m,
          ROW_NUMBER() OVER (
            PARTITION BY f.fsq_place_id
            ORDER BY ST_DISTANCE(f.geo, c.geo)
          ) AS rn
        FROM fsq f
        JOIN cat c
          ON ST_DWITHIN(f.geo, c.geo, @radius)
      )
      SELECT fsq_place_id, handle, fsq_name, google_place_id, cat_name, dist_m
      FROM joined
      WHERE rn = 1
    """
    params = [
        bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id),
        bigquery.ScalarQueryParameter("radius", "FLOAT64", float(radius_m)),
    ]
    return pipeline.execute(sql, params)


def _store_branch_rows(pairs, run_id: str, now):
    """(google_place_id, handle) 集合 → store_branch 行群（chain-dedup つき）。

    4_1 の store_branch 規律と同一: 同じ handle が 2 店以上の google_place_id に付いたら
    チェーン公式/集約なので落とし、1 店だけに付く handle を store_branch にする。全件を
    見て判定するためここで行う。返り値は行 list と «チェーン除外 handle 数»。
    """
    handle_to_pids: dict[str, set[str]] = {}
    for pid, handle in pairs:
        if not pid or not handle:
            continue
        handle_to_pids.setdefault(handle, set()).add(pid)

    rows: list[dict] = []
    dropped_chain = 0
    for handle, pids in handle_to_pids.items():
        if len(pids) >= 2:
            dropped_chain += 1
            continue
        (pid,) = tuple(pids)
        rows.append({
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "store_branch", "discovery_method": DISCOVERY_METHOD,
            "discovery_seed_place_id": pid,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        })
    return rows, dropped_chain


def _delete_source_rows(pipeline: BigQueryPipeline, run_id: str) -> int:
    """この run_id × discovery_method の行だけ消す（相乗り source を巻き込まない）。4_1 と同じ。"""
    from google.cloud import bigquery

    sql = (
        f"DELETE FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` "
        f"WHERE run_id = @rid AND discovery_method = @dm"
    )
    job = pipeline.client.query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ScalarQueryParameter("dm", "STRING", DISCOVERY_METHOD),
        ]),
        location=pipeline.config.region,
    )
    job.result()
    return int(job.num_dml_affected_rows or 0)


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    csv_path = _resolve_csv_path(Path(args.fsq_csv))
    LOGGER.info("FSQ 入力: %s", csv_path)

    stage_name = _stage_table_name(run_id)

    step_name = "4_1c_foursquare_store_accounts" + (":dry-run" if args.dry_run else "")
    with pipeline.step(run_id, step_name, repo_root=HERE.parents[1],
                       parameters={"radius_m": args.match_radius_m, "dry_run": args.dry_run}) as result:
        # 1) CSV → staging 行
        staging_rows, n_csv, n_valid_handle = _read_staging_rows(csv_path, args.limit)
        n_staged = len(staging_rows)
        LOGGER.info("CSV %d 行、有効 handle %d、座標つき staging %d 行", n_csv, n_valid_handle, n_staged)
        if n_staged == 0:
            raise ValueError("staging に載せられる有効行が 0 件です（handle/座標が全滅）。")

        catalog_run_id = args.catalog_run_id or _latest_catalog_run_id(pipeline)
        LOGGER.info("restaurant_catalog run_id=%s へ半径 %.0fm で照合します",
                    catalog_run_id, args.match_radius_m)

        try:
            # 2) staging へ load
            _create_stage_table(pipeline, stage_name)
            pipeline.load_json_rows(stage_name, staging_rows)

            # 3) 空間 JOIN で最寄り 1 件を取り、4) 名前サニティチェックを Python で課す
            pairs: list[tuple[str, str]] = []
            n_nearest = 0
            n_matched = 0
            for row in _spatial_match(pipeline, stage_name, catalog_run_id, args.match_radius_m):
                n_nearest += 1
                if not _names_share_token(row["fsq_name"], row["cat_name"]):
                    continue
                n_matched += 1
                pairs.append((row["google_place_id"], row["handle"]))

            # 5) chain-dedup → store_branch 行
            rows, dropped_chain = _store_branch_rows(pairs, run_id, now)
            n_after_dedup = len(rows)

            match_rate = (n_matched / n_staged) if n_staged else 0.0
            LOGGER.info(
                "照合結果: 最寄り候補 %d / 名前一致 matched %d / chain除外 %d / store_branch %d",
                n_nearest, n_matched, dropped_chain, n_after_dedup,
            )
            LOGGER.info(
                "統計: n_csv=%d n_valid_handle=%d n_matched_to_catalog=%d "
                "n_after_chain_dedup=%d match_rate=%.4f",
                n_csv, n_valid_handle, n_matched, n_after_dedup, match_rate,
            )

            # 6) 書き込み（dry-run では書かない）
            if args.dry_run:
                LOGGER.info("dry-run: sns_source_account へは書き込みません（統計のみ）。")
                result["row_count"] = 0
            else:
                deleted = _delete_source_rows(pipeline, run_id)
                LOGGER.info("既存 %s 行 %d 件を削除（run_id=%s の冪等化）", DISCOVERY_METHOD, deleted, run_id)
                if rows:
                    count = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, rows)
                else:
                    count = 0
                    LOGGER.warning("投入対象の store_branch 行が 0 件でした。")
                result["row_count"] = count
                LOGGER.info("sns_source_account に %d 件を投入しました（%s）", count, DISCOVERY_METHOD)
        finally:
            # 7) staging は常に片付ける
            _drop_stage_table(pipeline, stage_name)


if __name__ == "__main__":
    main()
