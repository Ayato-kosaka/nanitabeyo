#!/usr/bin/env python3
"""#1273 アイデアK: 店舗自身が発信しているメディア（自店YouTubeチャンネル）の実測

これまでの Discovery は全て第三者（グルメYouTuber）の動画だった。店舗自身が
YouTube チャンネルを持っているなら「その店の料理」であることが確実で精度が高い。
本スクリプトは以下を実測する。

  1. Overture の websites/socials に youtube.com が入っている件数（duckdb, 別途集計）
  2. 600店サンプルの決定的部分集合について、YouTube の**チャンネル検索**
     (sp=EgIQAg%3D%3D) を yt-dlp で引く
  3. 店名とチャンネル名が厳格一致するチャンネルの件数（= カバレッジ）
  4. 一致したチャンネルの動画本数
  5. 目視分類用に生のチャンネル名・説明文を出力する

実行:
    python3 restaurant-own-channel.py --n 200 --concurrency 6
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
OUT = HERE / "out"
YT_DLP = Path("/tmp/yt-dlp-latest")
SLUG = "restaurant-own-channel"

# #1273 【設計】チャンネル検索のフィルタ。sp=EgIQAg%3D%3D が「チャンネル」タブに相当する。
CHANNEL_FILTER = "EgIQAg%253D%253D"

CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")

# #1273 【仕様】一般名詞そのものの店名は、同名チャンネルが無関係に大量に存在するため
# 自店チャンネル判定から除外する（measure_channel_traversal.py と同じ規律）。
STOPWORD_NAMES = {
    "食堂", "カフェ", "レストラン", "居酒屋", "喫茶店", "ラーメン", "そば", "うどん",
    "寿司", "すし", "焼肉", "定食", "パン屋", "弁当", "cafe", "bar", "restaurant",
    "コーヒー", "ダイニング", "キッチン", "ビストロ", "食事処", "お食事処",
}
MIN_JA = 3   # 日本語の店名はこの長さ以上でないと一致を認めない
MIN_LATIN = 5  # ラテン名は語境界を課した上でさらに長さを要求する


def has_cjk(t: str) -> bool:
    return bool(CJK_RE.search(t))


def norm_ja(t: str) -> str:
    if not t:
        return ""
    t = unicodedata.normalize("NFKC", t).lower()
    return re.sub(r"[\s　\-‐－—–_,.、。・/／\\|｜!！?？\"'“”'']+", "", t)


def norm_latin(t: str) -> str:
    if not t:
        return ""
    t = unicodedata.normalize("NFKC", t).lower()
    return " " + re.sub(r"[^0-9a-z]+", " ", t).strip() + " "


# #1273 【仕様】自店チャンネルにありがちな接尾辞。店名一致を判定する前にチャンネル名から
# 落とす（「〇〇 公式チャンネル」を「〇〇」と一致させるため）。
CHANNEL_SUFFIX_RE = re.compile(
    r"(公式|オフィシャル|official|channel|チャンネル|ちゃんねる|ch|tv|"
    r"youtube|株式会社|有限会社|グループ|group)",
)


def name_match(store: str, channel: str) -> tuple[bool, str]:
    """店名とチャンネル名の厳格一致。理由文字列も返す。

    # #1273 【バグ】過去に「空白を除去して部分一致」で偽陽性まみれになった事故があるため、
    # 日本語とラテン文字で正規化とマッチ規則を分ける。ラテン名は語境界必須。
    """
    if not store or not channel:
        return False, "empty"
    if has_cjk(store):
        s, c = norm_ja(store), norm_ja(channel)
        if len(s) < MIN_JA or s in {norm_ja(x) for x in STOPWORD_NAMES}:
            return False, "too_short_or_stopword"
        if s == c:
            return True, "exact"
        if s in c:
            # 余分な部分が定型接尾辞・記号・地名だけなら自店チャンネルとみなす
            rest = c.replace(s, "", 1)
            rest2 = CHANNEL_SUFFIX_RE.sub("", rest)
            if len(rest2) <= 4:
                return True, f"store_in_channel(rest={rest!r})"
            return True, f"store_in_channel_loose(rest={rest!r})"
        return False, "no_match"
    # ラテン名
    s = norm_latin(store).strip()
    c = norm_latin(channel)
    if len(s) < MIN_LATIN or s in {norm_latin(x).strip() for x in STOPWORD_NAMES}:
        return False, "too_short_or_stopword"
    if s == c.strip():
        return True, "exact"
    idx = c.find(" " + s + " ")
    if idx >= 0:
        return True, "store_in_channel_wordbound"
    return False, "no_match"


def yt_json(target: str, timeout: int, extra: list[str] | None = None) -> tuple[dict | None, str | None]:
    cmd = [sys.executable, str(YT_DLP), "--flat-playlist", "-J", "--no-warnings",
           *(extra or []), target]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if not p.stdout.strip():
        err = p.stderr.strip().splitlines()[-1][:160] if p.stderr.strip() else "empty"
        return None, err
    try:
        return json.loads(p.stdout.splitlines()[-1]), None
    except json.JSONDecodeError:
        return None, "json_decode_error"


def load_chain_names() -> Counter:
    """#1273 §23【設計】ブランド全体アカウントでは支店を確定できないため、
    全国に同名が複数ある店名（チェーン）を数えておき、判定結果に必ず添える。"""
    csv.field_size_limit(10**7)
    freq: Counter = Counter()
    for fn in ("overture_jp_food.csv", "ifas_jp_food.csv"):
        p = FIXTURES / fn
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                n = (r.get("name") or "").strip()
                if n:
                    freq[norm_ja(n) if has_cjk(n) else norm_latin(n).strip()] += 1
    return freq


def deterministic_subset(results: list[dict], n: int) -> list[dict]:
    """#1273 【仕様】カバレッジを他ソースと合算できるよう、必ず同じ600店の
    決定的部分集合を使う。id を SHA-256 でソートして先頭 N 件。"""
    ranked = sorted(results, key=lambda r: hashlib.sha256(
        r["restaurant"]["id"].encode()).hexdigest())
    return ranked[:n]


# #1273 【仕様】目視分類の結果（29件の店名一致チャンネルを人が読んで分類した）。
# own      = その店舗自身の公式チャンネル（支店を確定できる）
# brand    = ブランド全体アカウント。#1273 §23 のとおり支店を確定できないので採用不可
# false    = 同名の無関係チャンネル（ゲーム実況・海外・個人・別業種など）
MANUAL_LABELS: dict[str, str] = {
    "Liberta": "false",            # ジョージア語のゲーム実況チャンネル
    "カマナ": "false",              # 「カマナ放送局」個人チャンネル
    "あん庵": "false",              # 和菓子工房あん庵。説明文の「寺内町銘菓」は富田林で前橋市の店ではない
    "幸楽苑": "brand",              # 全国120店のチェーン本部公式
    "Airi/愛梨": "false",           # 個人の美容チャンネル
    "むとう": "false",              # 説明文も動画も無く同定不能
    "Gemma": "false",              # スペイン語の心理カウンセラー
    "ほっともっと": "brand",         # 全国2,269店のチェーン本部公式
    "Quattro": "false",            # アラビア語のサッカーアカデミー
    "インディアン": "false",          # 「爆裂インディアンズ」ファッション系YouTuber
    "吉野家": "brand",              # 全国1,294店のチェーン本部公式
    "ポチ家": "false",              # 猫の動画チャンネル
    "いし井": "false",              # 「酒chいし井」日本酒資格の講座チャンネル。広島市中区の店ではない
    "純珈琲": "false",              # 「鰤純珈琲」第五人格のゲーム実況
    "やむたん": "false",             # ゲーム実況
    "ウマゴヤ": "false",             # 北海道の森づくり・DIY
    "鶴屋吉信": "brand",             # 京都本店のブランド公式。サンプル店は横浜市青葉区店
    "やきまる": "false",             # 「やきまるもち」スプラトゥーン実況
    "シェヴー": "false",             # 登録者1・動画0で同定不能
    "なにわ": "false",              # 歯科医のチャンネル
    "なかよし家": "false",            # 新潟のグループホーム
    "喜相逢": "false",              # 中国語ドラマ
    "ソウルチキン": "false",          # ゲーム実況
    "DENOMu": "false",             # 説明文なし・別人の個人チャンネル
    "おやじ食堂": "false",           # 家庭料理系の個人チャンネル。伊丹市の店ではない
    "Asian Table": "false",        # 登録者20万のアジア屋台紹介チャンネル。名古屋の店ではない
    "Ashoka": "false",             # インドのNGO / 大学関連
    "8番らーめん": "brand",          # 北陸49店のチェーン本部公式（+福井の別支店チャンネル）
    "519worklodge": "own",         # 上田市技術研修センター本体の公式チャンネル。locality一致
}


def overture_youtube_counts() -> dict:
    """#1273 【設計】Overture の websites/socials 配列に youtube.com が何件入っているかを数える。
    自店チャンネルが構造化データとして既に取れるなら検索は不要になるので、まずここを見る。"""
    try:
        import duckdb  # type: ignore
    except ImportError:
        return {"error": "duckdb not available"}
    con = duckdb.connect()
    con.execute(f"CREATE VIEW food AS SELECT * FROM read_csv_auto('{FIXTURES/'overture_jp_food.csv'}')")
    yt = ("list_contains(list_transform(coalesce(o.websites,[])||coalesce(o.socials,[]), "
          "x -> lower(x) LIKE '%youtube.com%' OR lower(x) LIKE '%youtu.be%'), true)")
    n_food, n_yt = con.execute(
        f"SELECT count(*), count(*) FILTER (WHERE {yt}) FROM food f "
        f"JOIN read_parquet('/tmp/overture-jp.parquet') o USING (id)").fetchone()
    return {"n_food_poi": n_food, "n_with_youtube_url": n_yt,
            "pct": round(100.0 * n_yt / n_food, 4) if n_food else -1.0}


def finalize(args, rows, ok_rows, hits, vids, n_req: int) -> None:
    """#1273 【設計】集計と保存。--reaggregate から再利用するため関数に切り出す。"""
    # --- 目視分類の反映 ---
    lab = Counter()
    for r in rows:
        if r["hit"]:
            r["manual_label"] = MANUAL_LABELS.get(r["name"], "unreviewed")
            lab[r["manual_label"]] += 1

    n = len(ok_rows)
    cov = 100.0 * len(hits) / n if n else -1.0
    cov_own = 100.0 * lab["own"] / n if n else -1.0
    cov_own_or_brand = 100.0 * (lab["own"] + lab["brand"]) / n if n else -1.0
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "slug": SLUG,
        "method": "YouTube channel-search (sp=EgIQAg) per store name via yt-dlp; "
                  "strict JA/Latin name match against channel title",
        "sample_source": "out/supply_ceiling_2026-08-13.json (600) -> SHA-256 sorted first N",
        "sample_n_requested": n_req,
        "n_evaluated": n,
        "n_errors": len(rows) - n,
        "n_hits": len(hits),
        "coverage_pct_raw_namematch": cov,
        "manual_label_counts": dict(lab),
        # #1273 【仕様】採用可能なカバレッジは own のみ。brand は支店を確定できない（§23）
        "coverage_pct": cov_own,
        "coverage_pct_own_or_brand": cov_own_or_brand,
        "precision_own_over_hits": (lab["own"] / len(hits)) if hits else -1.0,
        "overture_youtube": overture_youtube_counts(),
        "videos_probed": len(vids),
        "n_videos_total": sum(v.get("n_videos_listed") or 0 for v in vids),
        "results": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[done] coverage={cov:.2f}% ({len(hits)}/{n}) -> {args.out}", file=sys.stderr)



def run_recall(n: int, concurrency: int) -> dict:
    """#1273 【設計】recall の下限測定。Overture の websites に自店チャンネルURLが
    載っている店（= 自店チャンネルを持つことが確定している店）について、
    同じ店名チャンネル検索でそのチャンネルを再発見できるかを測る。
    ここが低ければ「検索で見つからないだけで実在する」分をカバレッジが取り落としている。"""
    import duckdb  # type: ignore
    con = duckdb.connect()
    con.execute(f"CREATE VIEW food AS SELECT * FROM read_csv_auto('{FIXTURES/'overture_jp_food.csv'}')")
    rows = con.execute(
        "SELECT f.name, f.locality, coalesce(o.websites,[])||coalesce(o.socials,[]) "
        "FROM food f JOIN read_parquet('/tmp/overture-jp.parquet') o USING (id) "
        "WHERE list_contains(list_transform(coalesce(o.websites,[])||coalesce(o.socials,[]), "
        "x -> lower(x) LIKE '%youtube.com%' OR lower(x) LIKE '%youtu.be%'), true)").fetchall()
    known = [{"name": r[0], "locality": r[1],
              "urls": [u for u in (r[2] or []) if "youtu" in u.lower()]} for r in rows]
    # チャンネルURL（単発動画URLではない）を持つ店だけが recall の母集団になる
    chan = [k for k in known if any(re.search(r"youtube\.com/(@|channel/|c/|user/)", u) for u in k["urls"])]
    chan.sort(key=lambda x: hashlib.sha256(x["name"].encode()).hexdigest())
    sel = chan[:n]

    def work(x: dict) -> dict:
        url = f"https://www.youtube.com/results?search_query={quote(x['name'])}&sp={CHANNEL_FILTER}"
        data, err = yt_json(url, 120, ["--playlist-end", "8"])
        ent = [e for e in ((data or {}).get("entries") or []) if e]
        cands = []
        for e in ent:
            ch = e.get("channel") or e.get("title") or ""
            ok, why = name_match(x["name"], ch)
            cands.append({"channel": ch, "url": e.get("channel_url") or e.get("url"),
                          "matched": ok, "why": why})
        return {**x, "error": err, "n_results": len(ent),
                "hit": any(c["matched"] for c in cands), "candidates": cands}

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        out = list(pool.map(work, sel))
    ok = [r for r in out if r["error"] is None]
    return {"n_food_with_channel_url": len(chan), "n_food_with_any_youtube_url": len(known),
            "n_tested": len(ok), "n_namematch_hit": sum(1 for r in ok if r["hit"]),
            "results": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--video-probe", type=int, default=25,
                    help="動画本数を数えるチャンネルの上限（時間節約）")
    ap.add_argument("--out", type=Path, default=OUT / f"{SLUG}.json")
    # #1273 【パフォーマンス】目視分類のラベルを直すたびに YouTube を叩き直すのは無駄なので、
    # 既存の出力から再集計だけを行うモードを持つ。
    ap.add_argument("--reaggregate", action="store_true")
    ap.add_argument("--recall", type=int, default=0,
                    help="Overture に自店チャンネルURLがある店 N 件で recall を測る")
    args = ap.parse_args()

    if args.recall:
        rec = run_recall(args.recall, args.concurrency)
        p = OUT / f"{SLUG}-recall.json"
        p.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[recall] namematch hit {rec['n_namematch_hit']}/{rec['n_tested']} -> {p}",
              file=sys.stderr)
        return

    if args.reaggregate:
        prev = json.loads(args.out.read_text(encoding="utf-8"))
        rows = prev["results"]
        ok_rows = [r for r in rows if r["error"] is None]
        hits = [r for r in ok_rows if r["hit"]]
        vids = [r["videos"] for r in rows if r.get("videos")]
        args_n = prev.get("sample_n_requested", len(rows))
        finalize(args, rows, ok_rows, hits, vids, args_n)
        return

    base = json.loads((OUT / "supply_ceiling_2026-08-13.json").read_text(encoding="utf-8"))
    sample = deterministic_subset(base["results"], args.n)
    print(f"[sample] 600店中 SHA-256順 先頭 {len(sample)} 件", file=sys.stderr)

    chain_freq = load_chain_names()

    def work(row: dict) -> dict:
        r = row["restaurant"]
        name = r["name"]
        url = (f"https://www.youtube.com/results?search_query={quote(name)}"
               f"&sp={CHANNEL_FILTER}")
        data, err = yt_json(url, 120, ["--playlist-end", "8"])
        entries = [e for e in ((data or {}).get("entries") or []) if e]
        cands = []
        for e in entries[:8]:
            ch = e.get("channel") or e.get("uploader") or e.get("title") or ""
            ok, why = name_match(name, ch)
            cands.append({
                "channel": ch,
                "channel_id": e.get("channel_id") or e.get("id"),
                "channel_url": e.get("channel_url") or e.get("url"),
                "subs": e.get("channel_follower_count"),
                "description": (e.get("description") or "")[:300],
                "matched": ok,
                "why": why,
            })
        key = norm_ja(name) if has_cjk(name) else norm_latin(name).strip()
        return {
            "id": r["id"], "name": name, "locality": r.get("locality"),
            "tier": r.get("tier"), "error": err,
            "n_channel_results": len(entries),
            "name_national_count": chain_freq.get(key, 0),
            "candidates": cands,
            "hit": any(c["matched"] for c in cands),
        }

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        rows = list(pool.map(work, sample))

    ok_rows = [r for r in rows if r["error"] is None]
    hits = [r for r in ok_rows if r["hit"]]
    print(f"[search] 評価 {len(ok_rows)} 件 / エラー {len(rows)-len(ok_rows)} 件, "
          f"店名一致チャンネル {len(hits)} 件", file=sys.stderr)

    # --- 一致チャンネルの動画本数を数える ---
    probe = hits[: args.video_probe]

    def count_videos(r: dict) -> dict:
        m = next(c for c in r["candidates"] if c["matched"])
        cu = m.get("channel_url") or ""
        if not cu:
            return {"id": r["id"], "videos_error": "no_url"}
        data, err = yt_json(cu.rstrip("/") + "/videos", 180, ["--playlist-end", "60"])
        ent = [e for e in ((data or {}).get("entries") or []) if e]
        return {
            "id": r["id"], "name": r["name"], "channel": m["channel"],
            "channel_url": cu, "subs": m.get("subs"),
            "videos_error": err,
            "n_videos_listed": len(ent),
            "video_titles": [e.get("title") for e in ent[:30]],
        }

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        vids = list(pool.map(count_videos, probe))
    vmap = {v["id"]: v for v in vids}
    for r in rows:
        if r["id"] in vmap:
            r["videos"] = vmap[r["id"]]

    finalize(args, rows, ok_rows, hits, vids, args.n)

if __name__ == "__main__":
    main()
