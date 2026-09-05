#!/usr/bin/env python3
"""#1273 収集ルート1/2: sns_source_account の各アカウントの投稿URLを sns_post_raw へ入れる。

Instagram Graph API の business_discovery で、対象ハンドルの media(permalink) を集める。
#1273 caption も保存する（business_discovery が id,permalink と同じ 1 コールで返す＝追加コスト無し）。
resolve へ caption を渡すと IG を取りに行かず並列できる（柱1 の大量投稿を parallel resolve する土台）。

IG_TOKEN は GitHub Actions secret。business_discovery に必要な «自分の IG ビジネスアカウント id» は
env IG_USER_ID があれば使い、無ければ /me/accounts から自動解決する。

レート制限（~200コール/時, code 4）に当たったら指数バックオフで待つ。全量は数日かかる想定なので
--max-accounts / --limit-per-account でバッチ分割し、同一 run_id の途中再開は delete_run_rows で冪等化。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PREF_PATTERN, PROVIDER_INSTAGRAM, TABLE_COVERAGE, TABLE_POST_RAW,
                        TABLE_SOURCE_ACCOUNT, ig_shortcode_from_url)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent
GRAPH = "https://graph.facebook.com/v23.0"
# #1273 4_19 が書く候補表（正本は 4_19_rank_account_candidates.py）。
TABLE_ACCOUNT_CANDIDATE = "sns_account_candidate_v2"
# BigQuery は ORDER BY の «裸の 0» を列番号と解釈して 400 を返す（2026-09-05 実測）。
# 並べ替えを効かせないときはこの式を置く。
_NO_ORDER = "CAST(0 AS INT64)"

_ROUTE_BY_ACCOUNT_TYPE = {
    "influencer": "influencer",
    "store_branch": "store_account",
    "store_brand": "store_account",
}


class RateLimited(Exception):
    pass


class AccountNotDiscoverable(Exception):
    """handle が存在しない / ビジネス・クリエイターでない等、そのアカウントを飛ばすべき状態。"""


# #1812 レート制御: Graph API は毎レスポンスに x-app-usage（アプリ単位の使用率 %）を返す。
# これを見ずに投げ続けると 100% で (#4) を食らい、以後 1 時間近くロックされる。実測でも
# «最初の 5 分で 37 アカウント → 次の 53 分で 0» というバースト→全損の形になっていた。
# 使用率が上がったら自分で減速する方が、同じ枠で連続的に多く取れる。
_APP_USAGE = {"pct": 0}


def _note_usage(headers) -> None:
    raw = headers.get("x-app-usage") or headers.get("X-App-Usage")
    if not raw:
        return
    try:
        d = json.loads(raw)
    except Exception:  # noqa: BLE001 - ヘッダが壊れていても本処理は止めない
        return
    _APP_USAGE["pct"] = max(int(d.get("call_count") or 0), int(d.get("total_time") or 0),
                            int(d.get("total_cputime") or 0))


def pace_for_app_usage() -> None:
    """x-app-usage の使用率に応じて呼び出し前に待つ（100% に当てない）。"""
    pct = _APP_USAGE["pct"]
    delay = 60 if pct >= 95 else 20 if pct >= 85 else 8 if pct >= 75 else 2 if pct >= 60 else 0
    if delay:
        LOGGER.debug("x-app-usage %d%% のため %ds 待機", pct, delay)
        time.sleep(delay)


# #1815 IG 側の一時エラーで «6 時間の収集ジョブ» を落とさない。
#
# 2026-09-05、341 件の influencer を採る予定だった run が **28 アカウントで落ちた**。
# 原因は 1 回の `IG API 500: {"error":{... "is_transient":true ...}}`。相手が
# «あとで試して» と明示しているものを、こちらは即座に例外にしてバッチごと終わらせていた。
#
# 同じ考え違いを resolve 側では既に直してある（`common_sns.ResolveClient` の 429/5xx 再送）。
# «相手の一時的な失敗を、自分の恒久的な失敗として扱わない» は 1 箇所の話ではないので、
# IG を叩くこの経路にも同じ規則を入れる。
#
# 再送してよいのは «相手が一時的だと言っているもの» だけ:
#   - `error.is_transient` が true
#   - HTTP 5xx（サーバ側の失敗）
# レート制限（code 4 / 17 / 613 / 429）は別扱いのまま（`RateLimited` で呼び出し側が待つ）。
# handle が引けない（code 110）も別扱いのまま（そのアカウントだけ飛ばす）。
TRANSIENT_RETRIES = 3
TRANSIENT_BACKOFF_S = (5.0, 20.0, 60.0)


def _is_transient(err: dict, http_status: int) -> bool:
    """相手が «一時的» と言っているか。ここだけが再送の可否を決める。"""
    return bool(err.get("is_transient")) or http_status >= 500


def _get(url: str, timeout: float = 30.0) -> dict:
    last: Exception | None = None
    for attempt in range(TRANSIENT_RETRIES + 1):
        try:
            return _get_once(url, timeout)
        except _TransientIGError as e:
            last = e
            if attempt >= TRANSIENT_RETRIES:
                break
            delay = TRANSIENT_BACKOFF_S[min(attempt, len(TRANSIENT_BACKOFF_S) - 1)]
            LOGGER.warning("IG の一時エラー（%s）。%.0f 秒待って再送します（%d/%d）",
                           e, delay, attempt + 1, TRANSIENT_RETRIES)
            time.sleep(delay)
    assert last is not None
    raise RuntimeError(str(last))


class _TransientIGError(RuntimeError):
    """相手が «あとで試して» と言った失敗。_get の中だけで使う。"""


def _get_once(url: str, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "nanitabeyo-sns-seed/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            _note_usage(resp.headers)
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        _note_usage(e.headers)
        body = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(body).get("error", {})
        except Exception:
            err = {}
        code = err.get("code")
        # code 4 = application rate limit, 17 = user rate limit, 613 = custom rate limit
        if code in (4, 17, 613) or e.code == 429:
            raise RateLimited(err.get("message") or body[:200])
        # code 110 = Invalid user id（存在しない handle 等）。business_discovery が引けない
        # アカウントは «そのアカウントを飛ばす» べき状態で、バッチ全体を止めない。
        if code == 110 or err.get("error_user_title") == "Cannot find User":
            raise AccountNotDiscoverable(err.get("error_user_msg") or err.get("message") or "not discoverable")
        if _is_transient(err, e.code):
            raise _TransientIGError(f"IG API {e.code}: {body[:300]}")
        raise RuntimeError(f"IG API {e.code}: {body[:300]}")


def resolve_ig_user_id(token: str, user_env: str = "IG_USER_ID") -> str:
    uid = os.getenv(user_env)
    if uid:
        return uid
    q = urllib.parse.urlencode({"fields": "instagram_business_account{id}", "access_token": token})
    d = _get(f"{GRAPH}/me/accounts?{q}")
    for page in d.get("data", []):
        iba = page.get("instagram_business_account")
        if iba and iba.get("id"):
            return iba["id"]
    raise RuntimeError("IG ビジネスアカウント id を解決できません。env IG_USER_ID を設定してください。")


def discover_media(ig: str, token: str, handle: str, per_account_limit: int, page_size: int = 50):
    """business_discovery で handle の media を（ページングして）yield する。"""
    after = None
    fetched = 0
    backoff = 30
    while fetched < per_account_limit:
        limit = min(page_size, per_account_limit - fetched)
        media_args = f"media.limit({limit})" + (f".after({after})" if after else "")
        # #1273 caption も取る（business_discovery は 1 コールで返す＝追加コスト無し）。
        # resolve へ渡すと IG を取りに行かず並列できる（柱1 の 57k 未 resolve を parallel 化する路）。
        fields = f"business_discovery.username({handle}){{{media_args}{{id,permalink,caption}}}}"
        q = urllib.parse.urlencode({"fields": fields, "access_token": token})
        pace_for_app_usage()
        try:
            d = _get(f"{GRAPH}/{ig}?{q}")
        except RateLimited as e:
            LOGGER.warning("rate limited (%s). %ds 待機します", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 900)
            continue
        except AccountNotDiscoverable as e:
            LOGGER.info("  @%s: skip（%s）", handle, str(e)[:80])
            return
        bd = d.get("business_discovery")
        if not bd:  # username が business/creator でない、非公開、存在しない 等
            return
        media = bd.get("media", {})
        for m in media.get("data", []):
            if m.get("permalink") and m.get("id"):
                fetched += 1
                yield m["id"], m["permalink"], (m.get("caption") or None)
        after = media.get("paging", {}).get("cursors", {}).get("after")
        if not after:
            return
        time.sleep(1)  # 連続ページングは軽く間隔を空ける


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="business_discovery で投稿URLを収集する（ルート1/2）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--account-run-id", default=None, help="読む sns_source_account の run_id（省略時は --run-id と同じ）")
    # #1815 在庫の handle は «発見した run» ごとに分かれて入る（sitecrawl / fsq / catalog / 08-31 …）。
    # 単一 run_id しか読めないと «別 run で発見した店» は永久に収集対象へ入らない。実測で
    # 40,911 handle のうち 34,615（84.6%）が «一度も収集を試されていない» 状態だった。カンマ区切りで union する。
    p.add_argument("--account-run-ids", default=None,
                   help="読む sns_source_account の run_id をカンマ区切りで（--account-run-id より優先）")
    # #1815 «既に投稿がある handle» の判定範囲。run = この出力 run だけ（従来）/ any = どの run でも
    # 1 枚でも採れている handle は飛ばす。KPI は «異なり店» なので、同じ店を採り直しても 1 セルも増えない。
    p.add_argument("--skip-collected-scope", default="run", choices=["run", "any"],
                   help="収集済みと見なす範囲。any なら他 run で採れている handle も飛ばす（既定 run）")
    # #1815 KPI 直結の並び替え。«あと 1〜3 店で 5 店に届くセル» を持つ市区町村の店から先に採る。
    # 指定しなければ従来どおり handle の昇順（＝アルファベット順で頭から）。
    # ⚠️ **«ハンドルの綴りで段を決めれば 86 倍» は交絡で、撤回済み（2026-09-05）。**
    # あの数字は成果を `matched` で数えていた。«配信カタログに載る異なり店» で層別すると、
    # 効いていたのは綴りではなく `sns_source_account.account_type` だった:
    #
    #   influencer 26.2〜44.5 店/アカ ／ store_branch 0.67〜1.13 ／ unknown 0.13〜0.94
    #
    # さらに «新しく増えた配信店» で測ると差はもっと大きい。手作り influencer 一覧は
    # 8 アカウントで新規 446 店（76.38 店/アカ）、店アカウントは 108 アカウントで新規 4 店。
    # 店アカウントの店は、経路B（店の公式サイトの埋め込み）が IG を叩かずに既に配信済みだから。
    #
    # したがって **IG 枠は influencer に使う**。段（`--tiers`）はラベルとして残すが、
    # 優先順位の根拠にはしない。経緯は `1273_instagram_seed_poc/FINDINGS.md` と
    # `handle_spelling_yield.py`（再現できる測定）にある。
    p.add_argument("--candidate-run-id", default=None,
                   help="sns_account_candidate_v2 の run_id。指定するとこの候補表を段の順に処理する")
    p.add_argument("--tiers", default=None,
                   help="処理する段をカンマ区切りで（例 A_food_region,B_food,C_region）。省略時は全部")
    p.add_argument("--priority-coverage-run-id", default=None,
                   help="sns_coverage の run_id。指定すると «惜しいセル» の多い市区町村の店を優先する")
    p.add_argument("--catalog-run-id", default=None,
                   help="住所・座標を引く restaurant_catalog の run_id（省略時は最大の run）")
    p.add_argument("--account-type", default=None,
                   choices=["influencer", "store_branch", "store_brand", "unknown"],
                   help="対象を絞る（省略時は全部）")
    # #1815 【設計】収集の順番は «ハンドルの綴り» ではなく **sns_source_account.account_type** で決める。
    # 2026-09-05 の層別実測（成果 = 配信カタログ sns_dish_media_catalog に載る異なり店 / アカウント）:
    #   influencer +食語 44.500 / influencer −食語 26.152 / store_branch +食語 1.127 /
    #   unknown +食語 0.944 / store_branch −食語 0.668 / unknown −食語 0.129
    # 食語（ハンドルの綴り）はどの層でも一貫して 1.7 倍効くが **層をまたぐ効果ではない**ので、
    # 綴りで先に並べると influencer が後ろへ回って逆効果になる。**まず account_type、次に食語**。
    p.add_argument("--order-by-account-layer", action="store_true",
                   help="account_type × 食語 の層の順に並べる（influencer → store_branch+食語 → …）")
    p.add_argument("--max-accounts", type=int, default=None, help="このバッチで処理するアカウント数上限")
    # #1815 既定を 200 → 10 へ。business_discovery は media.limit(N) を **1 コールで** 返すので
    # N<=50 なら 1 アカウント = 1 コール、N=200 だと 4 コール（実測スループット 88/h 対 ~220/h）。
    #
    # ⚠️ **適正値は段で違う**（2026-09-05 実測）。呼び出し側が明示すること。
    # - D 段（店アカウント）は 1 アカウント = 1 店なので、要るのは «その店のカテゴリが 1 つ以上
    #   決まる» ことだけ。柱1 の 2,104 店（投稿の 53.4% がカテゴリ付き）で
    #   3 枚 81.7% / 5 枚 87.2% / **10 枚 90.3%** / 20 枚 93.4% / 全 94.5 枚 93.4%。
    #   10 枚で満額の 96.7% を保ちつつ resolve の下流量は 1/9。→ 既定はこちら。
    # - A/B/C 段（ご当地グルメ・食べ歩きアカウント）は 1 アカウントが多数の店を回る。実測で
    #   198.6 投稿 = 4 コールから 49.5 店（12.4 店/コール）。枚数を絞ると店ごと落ちるので、
    #   **1 コールで取り切れる上限 50 を指定する**（51 枚目から 2 コール目に入る）。
    p.add_argument("--limit-per-account", type=int, default=10,
                   help="1 アカウントあたりの投稿数上限（D 段は 10、A/B/C 段は 50 を渡す）")
    # #1791 複数トークン並列化: business_discovery のレート制限は «アプリ(トークン)単位»。
    # シャードごとに別 Meta アプリのトークンを割り当てれば合算スループットが上がる。
    # 既定は従来どおり IG_TOKEN / IG_USER_ID。シャード2以降は --token-env IG_TOKEN_2 等で切替。
    p.add_argument("--token-env", default="IG_TOKEN",
                   help="business_discovery に使うトークンの env 名（#1791 シャード並列用。既定 IG_TOKEN）")
    p.add_argument("--user-env", default="IG_USER_ID",
                   help="IG ビジネスアカウント id の env 名（--token-env と対で切替。既定 IG_USER_ID）")
    # #1791 並列シャード: 複数トークンで «互いに素な» アカウント集合を同時に回すための分割。
    # handle のハッシュで N 分割し、各シャードは自分の担当分だけ処理する（重複収集を防ぐ）。
    p.add_argument("--shard-count", type=int, default=1, help="アカウントの分割数（#1791 並列用。既定 1=分割なし）")
    p.add_argument("--shard-index", type=int, default=0, help="このシャードの担当インデックス（0..shard-count-1）")
    return p.parse_args()


# #1273 4_19 の «段». 上ほど 1 コールあたりの期待 異なり店 が大きい。
# ⚠️ 4_19 は «配信カタログに載る異なり店/コール» で較正し直され、段の名前も並びも変わった
# （2026-09-05 実測: A_curated 31.862 / B_store_attributed 0.542 / C_region 0.057 /
# D_food 0.056 / E_rest 0.055）。**段の名前は 4_19 が正本**なので、ここは «知っている名前を
# 並べるだけ» にして、知らない名前は末尾へ落とす（4_19 が段を足しても 4_2 は壊れない）。
# 旧名（A_food_region / B_food / D_store_attributed）は、旧 run の候補表を読み直せるよう残す。
TIER_ORDER = ("A_curated", "A_food_region", "B_store_attributed", "B_food",
              "C_region", "D_food", "D_store_attributed", "E_rest")

# #1273 4_19 の region_token（ローマ字）→ 都道府県。段の **中** の並べ替えにだけ使う
# （段をまたいで逆転させない）。住所から都道府県を決める正本は common_sns.PREF_PATTERN で、
# これはハンドル文字列用の別物。広域語（kansai / kyushu 等）は 1 県に決まらないので入れない。
REGION_TOKEN_PREF_SQL = """
  SELECT * FROM UNNEST([
    STRUCT('sapporo' AS tok, '北海道' AS pref),
    STRUCT('hokkaido' AS tok, '北海道' AS pref),
    STRUCT('susukino' AS tok, '北海道' AS pref),
    STRUCT('hakodate' AS tok, '北海道' AS pref),
    STRUCT('asahikawa' AS tok, '北海道' AS pref),
    STRUCT('obihiro' AS tok, '北海道' AS pref),
    STRUCT('kushiro' AS tok, '北海道' AS pref),
    STRUCT('aomori' AS tok, '青森県' AS pref),
    STRUCT('hachinohe' AS tok, '青森県' AS pref),
    STRUCT('morioka' AS tok, '岩手県' AS pref),
    STRUCT('sendai' AS tok, '宮城県' AS pref),
    STRUCT('miyagi' AS tok, '宮城県' AS pref),
    STRUCT('akita' AS tok, '秋田県' AS pref),
    STRUCT('yamagata' AS tok, '山形県' AS pref),
    STRUCT('fukushima' AS tok, '福島県' AS pref),
    STRUCT('koriyama' AS tok, '福島県' AS pref),
    STRUCT('iwaki' AS tok, '福島県' AS pref),
    STRUCT('ibaraki' AS tok, '茨城県' AS pref),
    STRUCT('mito' AS tok, '茨城県' AS pref),
    STRUCT('tochigi' AS tok, '栃木県' AS pref),
    STRUCT('utsunomiya' AS tok, '栃木県' AS pref),
    STRUCT('gunma' AS tok, '群馬県' AS pref),
    STRUCT('maebashi' AS tok, '群馬県' AS pref),
    STRUCT('takasaki' AS tok, '群馬県' AS pref),
    STRUCT('saitama' AS tok, '埼玉県' AS pref),
    STRUCT('omiya' AS tok, '埼玉県' AS pref),
    STRUCT('kawagoe' AS tok, '埼玉県' AS pref),
    STRUCT('chiba' AS tok, '千葉県' AS pref),
    STRUCT('funabashi' AS tok, '千葉県' AS pref),
    STRUCT('kashiwa' AS tok, '千葉県' AS pref),
    STRUCT('tokyo' AS tok, '東京都' AS pref),
    STRUCT('shinjuku' AS tok, '東京都' AS pref),
    STRUCT('shibuya' AS tok, '東京都' AS pref),
    STRUCT('ikebukuro' AS tok, '東京都' AS pref),
    STRUCT('ueno' AS tok, '東京都' AS pref),
    STRUCT('ginza' AS tok, '東京都' AS pref),
    STRUCT('akihabara' AS tok, '東京都' AS pref),
    STRUCT('kichijoji' AS tok, '東京都' AS pref),
    STRUCT('nakameguro' AS tok, '東京都' AS pref),
    STRUCT('ebisu' AS tok, '東京都' AS pref),
    STRUCT('shimokita' AS tok, '東京都' AS pref),
    STRUCT('asakusa' AS tok, '東京都' AS pref),
    STRUCT('kanda' AS tok, '東京都' AS pref),
    STRUCT('shinbashi' AS tok, '東京都' AS pref),
    STRUCT('machida' AS tok, '東京都' AS pref),
    STRUCT('yokohama' AS tok, '神奈川県' AS pref),
    STRUCT('kawasaki' AS tok, '神奈川県' AS pref),
    STRUCT('shonan' AS tok, '神奈川県' AS pref),
    STRUCT('kamakura' AS tok, '神奈川県' AS pref),
    STRUCT('niigata' AS tok, '新潟県' AS pref),
    STRUCT('toyama' AS tok, '富山県' AS pref),
    STRUCT('kanazawa' AS tok, '石川県' AS pref),
    STRUCT('ishikawa' AS tok, '石川県' AS pref),
    STRUCT('fukui' AS tok, '福井県' AS pref),
    STRUCT('kofu' AS tok, '山梨県' AS pref),
    STRUCT('yamanashi' AS tok, '山梨県' AS pref),
    STRUCT('nagano' AS tok, '長野県' AS pref),
    STRUCT('matsumoto' AS tok, '長野県' AS pref),
    STRUCT('gifu' AS tok, '岐阜県' AS pref),
    STRUCT('shizuoka' AS tok, '静岡県' AS pref),
    STRUCT('hamamatsu' AS tok, '静岡県' AS pref),
    STRUCT('numazu' AS tok, '静岡県' AS pref),
    STRUCT('nagoya' AS tok, '愛知県' AS pref),
    STRUCT('aichi' AS tok, '愛知県' AS pref),
    STRUCT('sakae' AS tok, '愛知県' AS pref),
    STRUCT('toyota' AS tok, '愛知県' AS pref),
    STRUCT('okazaki' AS tok, '愛知県' AS pref),
    STRUCT('mie' AS tok, '三重県' AS pref),
    STRUCT('yokkaichi' AS tok, '三重県' AS pref),
    STRUCT('shiga' AS tok, '滋賀県' AS pref),
    STRUCT('otsu' AS tok, '滋賀県' AS pref),
    STRUCT('kyoto' AS tok, '京都府' AS pref),
    STRUCT('osaka' AS tok, '大阪府' AS pref),
    STRUCT('umeda' AS tok, '大阪府' AS pref),
    STRUCT('namba' AS tok, '大阪府' AS pref),
    STRUCT('shinsaibashi' AS tok, '大阪府' AS pref),
    STRUCT('kyobashi' AS tok, '大阪府' AS pref),
    STRUCT('tennoji' AS tok, '大阪府' AS pref),
    STRUCT('sakai' AS tok, '大阪府' AS pref),
    STRUCT('kobe' AS tok, '兵庫県' AS pref),
    STRUCT('sannomiya' AS tok, '兵庫県' AS pref),
    STRUCT('hyogo' AS tok, '兵庫県' AS pref),
    STRUCT('himeji' AS tok, '兵庫県' AS pref),
    STRUCT('nishinomiya' AS tok, '兵庫県' AS pref),
    STRUCT('nara' AS tok, '奈良県' AS pref),
    STRUCT('wakayama' AS tok, '和歌山県' AS pref),
    STRUCT('tottori' AS tok, '鳥取県' AS pref),
    STRUCT('shimane' AS tok, '島根県' AS pref),
    STRUCT('matsue' AS tok, '島根県' AS pref),
    STRUCT('okayama' AS tok, '岡山県' AS pref),
    STRUCT('kurashiki' AS tok, '岡山県' AS pref),
    STRUCT('hiroshima' AS tok, '広島県' AS pref),
    STRUCT('fukuyama' AS tok, '広島県' AS pref),
    STRUCT('yamaguchi' AS tok, '山口県' AS pref),
    STRUCT('shimonoseki' AS tok, '山口県' AS pref),
    STRUCT('tokushima' AS tok, '徳島県' AS pref),
    STRUCT('takamatsu' AS tok, '香川県' AS pref),
    STRUCT('kagawa' AS tok, '香川県' AS pref),
    STRUCT('matsuyama' AS tok, '愛媛県' AS pref),
    STRUCT('ehime' AS tok, '愛媛県' AS pref),
    STRUCT('kochi' AS tok, '高知県' AS pref),
    STRUCT('fukuoka' AS tok, '福岡県' AS pref),
    STRUCT('hakata' AS tok, '福岡県' AS pref),
    STRUCT('tenjin' AS tok, '福岡県' AS pref),
    STRUCT('kitakyushu' AS tok, '福岡県' AS pref),
    STRUCT('kokura' AS tok, '福岡県' AS pref),
    STRUCT('kurume' AS tok, '福岡県' AS pref),
    STRUCT('saga' AS tok, '佐賀県' AS pref),
    STRUCT('nagasaki' AS tok, '長崎県' AS pref),
    STRUCT('sasebo' AS tok, '長崎県' AS pref),
    STRUCT('kumamoto' AS tok, '熊本県' AS pref),
    STRUCT('oita' AS tok, '大分県' AS pref),
    STRUCT('beppu' AS tok, '大分県' AS pref),
    STRUCT('miyazaki' AS tok, '宮崎県' AS pref),
    STRUCT('kagoshima' AS tok, '鹿児島県' AS pref),
    STRUCT('okinawa' AS tok, '沖縄県' AS pref),
    STRUCT('naha' AS tok, '沖縄県' AS pref),
    STRUCT('ishigaki' AS tok, '沖縄県' AS pref)
  ])
"""


def _tier_rank_sql(column: str) -> str:
    cases = " ".join(f"WHEN '{t}' THEN {i}" for i, t in enumerate(TIER_ORDER))
    return f"CASE {column} {cases} ELSE {len(TIER_ORDER)} END"


def _read_candidates(pipeline: BigQueryPipeline, candidate_run_id: str, tiers, max_accounts,
                     shard_count: int = 1, shard_index: int = 0,
                     priority_coverage_run_id: str | None = None,
                     catalog_run_id: str | None = None):
    """4_19 の候補表を «段の順 → 段の中は惜しいセルの多い県から» で読む。

    段の中の並べ替えだけに coverage を使う（コーディネータの指示 2026-09-05）。段をまたいで
    «惜しいセル» で逆転させると、1 コールで 86 倍違う段の差を捨てることになる。
    """
    from google.cloud import bigquery
    where = "run_id = @cand_rid AND provider = @prov"
    params = [
        bigquery.ScalarQueryParameter("cand_rid", "STRING", candidate_run_id),
        bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
    ]
    if tiers:
        where += " AND tier IN UNNEST(@tiers)"
        params.append(bigquery.ArrayQueryParameter("tiers", "STRING", list(tiers)))
    if shard_count and shard_count > 1:
        where += " AND MOD(ABS(FARM_FINGERPRINT(handle)), @shard_count) = @shard_index"
        params.append(bigquery.ScalarQueryParameter("shard_count", "INT64", int(shard_count)))
        params.append(bigquery.ScalarQueryParameter("shard_index", "INT64", int(shard_index)))
    # 候補表は «4_19 を回した時点で未収集» なので、その後に他ジョブが採った分をここで外す。
    where += (" AND handle NOT IN ("
              f"SELECT DISTINCT LOWER(account_id) FROM `{pipeline.table(TABLE_POST_RAW)}` "
              "WHERE account_id IS NOT NULL)")
    limit_sql = f"LIMIT {int(max_accounts)}" if max_accounts else ""

    if priority_coverage_run_id:
        params.append(bigquery.ScalarQueryParameter("cov_rid", "STRING", priority_coverage_run_id))
        catalog_run_id = catalog_run_id or _latest_catalog_run_id(pipeline)
        params.append(bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id))
        # 惜しいセル（あと 1〜3 店で 5 店に届く = distinct_store_count 2..4）の重み。
        # 店アカウント（seed 有）は **その店の市区町村** で、地域語アカウントは
        # region_token → 都道府県 で当てる。どちらも取れなければ 0（段の末尾へ）。
        pref_join = f"""
      , tokmap AS ({REGION_TOKEN_PREF_SQL})
      , cellscore AS (
          SELECT region AS pref, city,
                 SUM(CASE distinct_store_count WHEN 4 THEN 3 WHEN 3 THEN 2 WHEN 2 THEN 1 ELSE 0 END) AS score
          FROM `{pipeline.table(TABLE_COVERAGE)}`
          WHERE run_id = @cov_rid AND source_route = 'all' AND region IS NOT NULL
          GROUP BY region, city
        )
      , prefscore AS (SELECT pref, SUM(score) AS score FROM cellscore GROUP BY pref)
      , cityscore AS (SELECT pref, city, score FROM cellscore WHERE city IS NOT NULL)
      , seedcity AS (
          SELECT google_place_id,
                 REGEXP_EXTRACT(address, r'({PREF_PATTERN})') AS pref,
                 REGEXP_EXTRACT(address, r'(?:{PREF_PATTERN})([^0-9０-９]{{2,8}}?[市区町村])') AS city
          FROM `{pipeline.table('restaurant_catalog')}`
          WHERE run_id = @crid
        )"""
        # 市区町村スコアは県スコアより桁が小さいので、比較できるよう県スコアへ寄せずに
        # «市区町村が分かるならそれ / 分からなければ県» の順で COALESCE する。
        score_expr = "IFNULL(cs.score, IFNULL(p.score, 0))"
        joins = ("LEFT JOIN seedcity sc ON sc.google_place_id = c.seed_place_id "
                 "LEFT JOIN cityscore cs ON cs.pref = sc.pref AND cs.city = sc.city "
                 "LEFT JOIN tokmap t ON t.tok = c.region_token "
                 "LEFT JOIN prefscore p ON p.pref = t.pref")
    else:
        pref_join, score_expr, joins = "", _NO_ORDER, ""

    sql = f"""
      WITH cand AS (
        SELECT handle, tier, region_token, mention_posters, seed_place_id, store_attributed
        FROM `{pipeline.table(TABLE_ACCOUNT_CANDIDATE)}`
        WHERE {where}
      ){pref_join}
      SELECT c.handle,
             IF(c.store_attributed, 'store_branch', 'influencer') AS account_type,
             c.seed_place_id AS discovery_seed_place_id,
             c.tier
      FROM cand c {joins}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY c.handle ORDER BY {score_expr} DESC) = 1
      ORDER BY {_tier_rank_sql('c.tier')}, {score_expr} DESC, c.mention_posters DESC, c.handle
      {limit_sql}
    """
    return list(pipeline.execute(sql, params))


def _food_token_regex() -> str:
    """食語の正本は 4_19（`FOOD_TOKENS`）。ここで語彙を書き写さない（ずれると層がずれる）。"""
    import importlib
    rank = importlib.import_module("4_19_rank_account_candidates")
    return rank._token_regex(rank.FOOD_TOKENS)


def _account_layer_sql(account_type_col: str, handle_col: str) -> str:
    """層の順位（小さいほど先）。正本は 2026-09-05 の層別実測（--order-by-account-layer の説明）。"""
    food = f"REGEXP_CONTAINS(LOWER({handle_col}), r'{_food_token_regex()}')"
    store = f"{account_type_col} IN ('store_branch', 'store_brand')"
    return (f"CASE WHEN {account_type_col} = 'influencer' AND {food} THEN 0 "
            f"WHEN {account_type_col} = 'influencer' THEN 1 "
            f"WHEN {store} AND {food} THEN 2 "
            f"WHEN {food} THEN 3 "
            f"WHEN {store} THEN 4 ELSE 5 END")


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    for row in pipeline.execute(
        f"SELECT run_id FROM `{pipeline.table('restaurant_catalog')}` "
        f"GROUP BY run_id ORDER BY COUNT(*) DESC LIMIT 1"
    ):
        return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id がありません。")


def _read_accounts(pipeline: BigQueryPipeline, account_run_ids, account_type, max_accounts,
                   output_run_id: str | None = None, shard_count: int = 1, shard_index: int = 0,
                   skip_collected_scope: str = "run",
                   priority_coverage_run_id: str | None = None,
                   catalog_run_id: str | None = None,
                   layer_order: bool = False):
    from google.cloud import bigquery
    # #1815 発見 run は増え続けるので «全部» を指定できるようにする（列挙を書き写さない）。
    if list(account_run_ids) == ["all"]:
        where = "provider = @prov"
        params = [bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM)]
    else:
        where = "run_id IN UNNEST(@acc_rids) AND provider = @prov"
        params = [
            bigquery.ArrayQueryParameter("acc_rids", "STRING", list(account_run_ids)),
            bigquery.ScalarQueryParameter("prov", "STRING", PROVIDER_INSTAGRAM),
        ]
    if account_type:
        where += " AND account_type = @atype"
        params.append(bigquery.ScalarQueryParameter("atype", "STRING", account_type))
    # #1791 並列シャード: handle のハッシュで N 分割。並列トークンで同時に回しても
    # 各シャードの担当が互いに素になり、二重収集しない。shard_count=1 なら無効。
    if shard_count and shard_count > 1:
        where += " AND MOD(ABS(FARM_FINGERPRINT(handle)), @shard_count) = @shard_index"
        params.append(bigquery.ScalarQueryParameter("shard_count", "INT64", int(shard_count)))
        params.append(bigquery.ScalarQueryParameter("shard_index", "INT64", int(shard_index)))

    # #1273 チャンク harvest: レート制限で全量が CI 1 ジョブ(6h)に収まらないので --max-accounts で
    # 分割する。毎回同じ先頭 N を選んで進まないのを防ぐため、**既に投稿がある handle は除外**する。
    # #1815 scope=any にすると «他 run で採れている handle» も除外する（KPI は異なり店なので採り直しは無価値）。
    if skip_collected_scope == "any":
        collected_where = "account_id IS NOT NULL"
    else:
        collected_where = "run_id = @out_rid AND account_id IS NOT NULL"
        params.append(bigquery.ScalarQueryParameter("out_rid", "STRING", output_run_id or ""))
    where += (" AND handle NOT IN ("
              f"SELECT DISTINCT account_id FROM `{pipeline.table(TABLE_POST_RAW)}` "
              f"WHERE {collected_where})")

    limit_sql = f"LIMIT {int(max_accounts)}" if max_accounts else ""
    todo_sql = f"""
      SELECT handle, ANY_VALUE(account_type) AS account_type,
             ANY_VALUE(discovery_seed_place_id) AS discovery_seed_place_id
      FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}`
      WHERE {where}
      GROUP BY handle
    """

    layer_sql = _account_layer_sql("account_type", "handle") if layer_order else _NO_ORDER

    if not priority_coverage_run_id:
        sql = (f"WITH todo AS ({todo_sql}) SELECT * FROM todo "
               f"ORDER BY {layer_sql}, handle {limit_sql}")
        return list(pipeline.execute(sql, params))

    # #1815 【設計】並びは «KPI にいちばん近いセルから». セルは (カテゴリ×市区町村) で、
    # あと 1〜3 店で 5 店に届くセル（distinct_store_count 2..4）を市区町村ごとに重み付けして数え、
    # その市区町村に居る店の handle を先に処理する。n=4 のセルは 1 店で埋まるので重い。
    # 店の市区町村は 7_1 と同じ考え方で決める: 住所から取れないもの（実測 49%）は
    # 最寄りの市区町村重心（20km 以内）を充てる。ここは «並び替え» なので厳密さより網羅を優先する。
    catalog_run_id = catalog_run_id or _latest_catalog_run_id(pipeline)
    params.append(bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id))
    params.append(bigquery.ScalarQueryParameter("cov_rid", "STRING", priority_coverage_run_id))
    layer_sql_t = _account_layer_sql("t.account_type", "t.handle") if layer_order else _NO_ORDER
    sql = f"""
      WITH todo AS ({todo_sql}),
      cat AS (
        SELECT google_place_id,
               REGEXP_EXTRACT(address, r'({PREF_PATTERN})') AS pref,
               REGEXP_EXTRACT(address, r'(?:{PREF_PATTERN})([^0-9０-９]{{2,8}}?[市区町村])') AS city,
               latitude AS lat, longitude AS lng
        FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = @crid
      ),
      cityc AS (
        SELECT pref, city, ST_GEOGPOINT(AVG(lng), AVG(lat)) AS g
        FROM cat WHERE pref IS NOT NULL AND city IS NOT NULL AND lat IS NOT NULL
        GROUP BY pref, city
      ),
      near AS (
        SELECT region AS pref, city,
               SUM(CASE distinct_store_count WHEN 4 THEN 3 WHEN 3 THEN 2 WHEN 2 THEN 1 ELSE 0 END) AS score
        FROM `{pipeline.table(TABLE_COVERAGE)}`
        WHERE run_id = @cov_rid AND source_route = 'all' AND region IS NOT NULL AND city IS NOT NULL
        GROUP BY region, city
      ),
      t1 AS (
        SELECT t.handle, t.account_type, t.discovery_seed_place_id, c.pref, c.city, c.lat, c.lng
        FROM todo t LEFT JOIN cat c ON c.google_place_id = t.discovery_seed_place_id
      ),
      nn AS (
        SELECT t.handle, cc.pref, cc.city
        FROM t1 t JOIN cityc cc
          ON t.city IS NULL AND t.lat IS NOT NULL
         AND ST_DWITHIN(ST_GEOGPOINT(t.lng, t.lat), cc.g, 20000)
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY t.handle ORDER BY ST_DISTANCE(ST_GEOGPOINT(t.lng, t.lat), cc.g)) = 1
      )
      SELECT t.handle, t.account_type, t.discovery_seed_place_id
      FROM t1 t
      LEFT JOIN nn USING (handle)
      LEFT JOIN near n
        ON n.pref = COALESCE(t.pref, nn.pref) AND n.city = COALESCE(t.city, nn.city)
      ORDER BY {layer_sql_t}, IFNULL(n.score, 0) DESC, t.handle
      {limit_sql}
    """
    return list(pipeline.execute(sql, params))


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    account_run_ids = [x.strip() for x in (args.account_run_ids or "").split(",") if x.strip()] \
        or [args.account_run_id or run_id]
    account_run_id = ",".join(account_run_ids)
    token = os.getenv(args.token_env)
    if not token:
        raise RuntimeError(f"{args.token_env} 未設定（db-script-run.yml の secret）。")

    pipeline = BigQueryPipeline()
    ig = resolve_ig_user_id(token, args.user_env)
    LOGGER.info("IG business account id = %s（token_env=%s）", ig, args.token_env)

    # output_run_id=run_id を渡すと «この run に既に投稿がある handle» を除外する（チャンク前進）。
    if args.candidate_run_id:
        tiers = [x.strip() for x in (args.tiers or "").split(",") if x.strip()]
        accounts = _read_candidates(
            pipeline, args.candidate_run_id, tiers, args.max_accounts,
            shard_count=args.shard_count, shard_index=args.shard_index,
            priority_coverage_run_id=args.priority_coverage_run_id,
            catalog_run_id=args.catalog_run_id)
        from collections import Counter
        LOGGER.info("候補表の段の内訳: %s", dict(Counter(a["tier"] for a in accounts)))
    else:
        accounts = _read_accounts(pipeline, account_run_ids, args.account_type, args.max_accounts,
                                  output_run_id=run_id,
                                  shard_count=args.shard_count, shard_index=args.shard_index,
                                  skip_collected_scope=args.skip_collected_scope,
                                  priority_coverage_run_id=args.priority_coverage_run_id,
                                  catalog_run_id=args.catalog_run_id,
                                  layer_order=args.order_by_account_layer)
    LOGGER.info("%d アカウントを処理します（未収集分。max=%s）", len(accounts), args.max_accounts)
    now = utc_now()
    now_iso = now.isoformat()

    with pipeline.step(run_id, "4_2_collect_account_posts", parameters={
        "account_run_id": account_run_id, "account_type": args.account_type,
        "max_accounts": args.max_accounts, "limit_per_account": args.limit_per_account,
        "skip_collected_scope": args.skip_collected_scope,
        "priority_coverage_run_id": args.priority_coverage_run_id,
        "shard": f"{args.shard_index}/{args.shard_count}",
        "candidate_run_id": args.candidate_run_id, "tiers": args.tiers,
        "order_by_account_layer": args.order_by_account_layer,
    }, repo_root=HERE.parents[1]) as result:
        # 収集は 413 アカウントを（レート制限のため）複数バッチに分けて回す。run_id 単位の
        # DELETE だと先行バッチを消してしまうので、**このバッチが担当するアカウント分だけ**を
        # 消してから入れ直す（バッチ冪等・他バッチ非破壊）。
        from google.cloud import bigquery
        handles = [acc["handle"] for acc in accounts]
        # #1815 scope=any のときは «どの run でも投稿が無い handle» しか選んでいないので消す行が無い。
        # 並列シャード中に無駄な DML を撃つと sns_post_raw の serialize 競合を増やすだけなので撃たない。
        if handles and args.skip_collected_scope != "any" and not args.candidate_run_id:
            pipeline.execute_dml_retrying(
                f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                f"WHERE run_id = @rid AND account_id IN UNNEST(@handles)",
                [
                    bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                    bigquery.ArrayQueryParameter("handles", "STRING", handles),
                ],
            )
        # 収集は数時間かかりレート制限で待つため、**アカウント FLUSH_EVERY 件ごとに逐次ロード**する。
        # 末尾一括ロードだと job が 6h timeout した瞬間に収集済みが全ロストするため（実リスク）。
        # WRITE_APPEND なので複数回呼んでも積み増しになる。seen は run 全体で共有し重複を防ぐ。
        # #1812 レート制限で待つ時間が長く、20 アカウント単位だと «2 時間 1 行も出ない»
        # 状態になり、生きているのか死んでいるのか外から判断できなかった。5 に下げる。
        FLUSH_EVERY = 5
        rows: list[dict] = []
        seen: set[str] = set()
        total = 0
        processed = 0

        def _flush() -> None:
            nonlocal rows, total
            if rows:
                total += pipeline.load_json_rows(TABLE_POST_RAW, rows)
                rows = []

        for acc in accounts:
            handle = acc["handle"]
            route = _ROUTE_BY_ACCOUNT_TYPE.get(acc["account_type"], "influencer")
            n = 0
            for media_id, permalink, caption in discover_media(ig, token, handle, args.limit_per_account):
                # 投稿の一意キーは shortcode（検索ルート4_3と揃え、跨ルート重複解決を防ぐ）
                pid = ig_shortcode_from_url(permalink) or media_id
                if pid in seen:
                    continue
                seen.add(pid)
                rows.append({
                    "post_id": pid, "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": permalink, "account_id": handle,
                    "discovery_route": route, "discovery_method": "ig_business_discovery",
                    "discovery_query": None,
                    "discovery_seed_place_id": acc["discovery_seed_place_id"],
                    "discovery_area_lat": None, "discovery_area_lng": None,
                    "discovery_category_id": None,
                    "caption": caption, "author_name": handle,
                    "fetched_at": now_iso, "run_id": run_id,
                })
                n += 1
            LOGGER.info("  @%s: %d posts", handle, n)
            processed += 1
            if processed % FLUSH_EVERY == 0:
                _flush()
                LOGGER.info("  … %d/%d アカウント処理・%d 投稿ロード済み（逐次）", processed, len(accounts), total)

        _flush()
        count = total
        result["row_count"] = count
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（%d アカウント）", count, len(accounts))


if __name__ == "__main__":
    main()
