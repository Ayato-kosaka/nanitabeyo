#!/usr/bin/env python3
"""#1273 「施設運営者がテナントの料理写真を出している」経路の母集団側の規模を測る

## なぜ

いままで測ってきた供給者は **店本人（自社サイト・SNS）** と **チェーン本部** の2つだけで、
どちらも「店がリンクを持っているか」に強く縛られる。リンク無し層 30.31% がここで詰まる。

**第三の供給者**として **施設運営者**（ショッピングセンター・駅ビル・空港・SA/PA・
百貨店・地下街）がある。施設は集客のためにテナントの料理写真を**自分のサイトで公開**する。
これは店のリンクの有無と**独立**している。並列で走らせている発案ワークフローの
1本目が同じ経路を挙げてきたので、**母集団側の規模だけ**を先に全数で確定させる。

## 測るもの（2通り。片方は自分の語彙に依存するので、依存しない方も出す）

**A. 屋号の施設トークン** — 「イオンモール○○店」「アトレ恵比寿店」のように、
日本の屋号は**施設名を屋号に埋め込む**。手書きの施設語彙で全 1,244,029 行を数える。
→ 自分が知っている施設しか数えられないので**下限**である。

**B. 同一地点への集積（語彙に依存しない）** — 施設内テナントは**座標がほぼ同じ**になる。
重複除去したうえで半径 50m 以内に **5店以上**が集まる塊を数える。
→ 商店街や駅前の雑居ビルも混ざるので**上限寄り**である。

A と B を挟むことで、施設テナントの規模を**下限と上限**で括る。

## この数字が言えないこと

ここで出すのは **母集団側の規模（経路存在率の分母）だけ**である。
「施設サイトに実際にその店の料理写真があるか」は**一切測っていない**。
施設サイトを引くには取得が要るので、それは別の測定にする。
**実効カバレッジをここから推定してはいけない。**

**ネットワークアクセスは一切しない。**

実行:
    python3 measure_facility_tenant.py
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_channel_traversal import has_cjk, normalize_ja, normalize_latin  # noqa: E402
from measure_locality_backfill import cell_of, haversine_km, load_rows  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# --- A: 施設語彙 ---------------------------------------------------------
# 手書きなので**網羅ではない**。自分が知っている範囲の主要事業者に限る。
# 種別ごとに分けるのは、種別ごとに「サイトに料理写真を出す度合い」が違うため。
FACILITY_VOCAB: dict[str, tuple[str, ...]] = {
    "sc_mall": (
        "イオンモール", "イオンタウン", "イオンスタイル", "ららぽーと", "ラゾーナ",
        "三井アウトレットパーク", "プレミアム・アウトレット", "プレミアムアウトレット",
        "テラスモール", "ダイバーシティ", "アリオ", "ゆめタウン", "ゆめモール",
        "モラージュ", "ピオレ", "コクーンシティ", "レイクタウン", "ヴィーナスフォート",
        "コレド", "COREDO", "パルコ", "PARCO", "OPA", "オーパ", "ビブレ",
        "フォレオ", "リヴィン", "サンストリート", "モレラ", "アピタ", "ピアゴ",
        "ゆめマート", "トレッサ", "ワンダーシティ", "ノースポート", "マークイズ",
        "MARK IS", "みなとみらい東急スクエア", "グランツリー", "セブンパーク",
        "ブランチ", "テラスウォーク", "フレスポ", "アシコタウン", "ベルモール",
    ),
    "station": (
        "アトレ", "atre", "エキュート", "ecute", "ルミネ", "LUMINE", "NEWoMan",
        "ニュウマン", "グランスタ", "GRANSTA", "エキマルシェ", "エキエ", "エキア",
        "エスカ", "アスティ", "ビエラ", "ミント神戸", "ステーションビル",
        "駅ビル", "シャポー", "ペリエ", "ラスカ", "テルミナ", "ボックスヒル",
        "セレオ", "CELEO", "エミオ", "EMIO", "グランデュオ", "ミーツ", "MEETS",
        "京王モール", "小田急百貨店", "エキシティ", "デリチカ", "エチカ",
        "エキマルクレープ", "アントレマルシェ", "デリド",
    ),
    "depachika": (
        "伊勢丹", "三越", "高島屋", "髙島屋", "大丸", "松坂屋", "そごう", "西武",
        "阪急", "阪神", "東武百貨店", "京王百貨店", "近鉄百貨店", "名鉄百貨店",
        "岩田屋", "丸井", "マルイ", "藤崎", "山形屋", "井筒屋", "トキハ",
    ),
    "airport": (
        "空港", "エアポート", "AIRPORT", "ターミナル", "羽田", "成田国際",
        "セントレア", "関西国際", "伊丹", "新千歳", "那覇空港",
    ),
    "highway": (
        "サービスエリア", "パーキングエリア", "SA上り", "SA下り", "PA上り", "PA下り",
        "ＳＡ", "ＰＡ", "道の駅", "ハイウェイオアシス", "EXPASA", "NEOPASA",
        "PASAR", "パサール", "談合坂", "海老名SA", "足柄SA",
    ),
    "underground": (
        "地下街", "クリスタ長堀", "ホワイティうめだ", "ディアモール", "なんばウォーク",
        "オーロラタウン", "ポールタウン", "さんちか", "エスカ地下街", "ユニモール",
        "サンロード", "セントラルパーク", "川反",
    ),
}


def norm_key(name: str) -> str:
    return normalize_ja(name) if has_cjk(name) else normalize_latin(name).strip()


def main() -> None:
    rows = list(load_rows())
    print(f"読み込み {len(rows):,} 行", file=sys.stderr)

    # --- 重複除去: 同じ店が最大3ソースに出る -------------------------------
    # 正規化した屋号 + 座標 3桁(≒110m) を1店とみなす
    places: dict[tuple, dict] = {}
    for r in rows:
        k = norm_key(r["name"])
        if not k:
            continue
        pk = (k, round(r["lat"], 3), round(r["lon"], 3))
        cur = places.get(pk)
        if cur is None:
            places[pk] = {"name": r["name"], "lat": r["lat"], "lon": r["lon"],
                          "has_link": r["has_link"],
                          "sources": {r["source"]}}
        else:
            cur["has_link"] = cur["has_link"] or r["has_link"]
            cur["sources"].add(r["source"])
    plist = list(places.values())
    n_place = len(plist)
    n_nolink = sum(1 for p in plist if not p["has_link"])
    print(f"重複除去後の店（場所単位）: {n_place:,}  うちリンク無し {n_nolink:,} "
          f"({n_nolink / n_place * 100:.2f}%)", file=sys.stderr)

    # --- A: 屋号の施設トークン --------------------------------------------
    print(f"\n=== A. 屋号に施設名が入っている店（手書き語彙・下限）===", file=sys.stderr)
    kind_of: dict[int, str] = {}
    hit_by_kind = collections.Counter()
    nolink_by_kind = collections.Counter()
    token_hits = collections.Counter()
    for i, p in enumerate(plist):
        nm = p["name"]
        for kind, toks in FACILITY_VOCAB.items():
            found = next((t for t in toks if t in nm), None)
            if found:
                kind_of[i] = kind
                hit_by_kind[kind] += 1
                token_hits[found] += 1
                if not p["has_link"]:
                    nolink_by_kind[kind] += 1
                break

    n_a = len(kind_of)
    n_a_nolink = sum(nolink_by_kind.values())
    print(f"{'種別':14}{'店数':>10}{'母集団比':>10}{'うちリンク無し':>14}{'その比':>9}",
          file=sys.stderr)
    out_a = {}
    for kind in FACILITY_VOCAB:
        h, nl = hit_by_kind[kind], nolink_by_kind[kind]
        out_a[kind] = {"n": h, "pct_of_population": h / n_place * 100,
                       "n_nolink": nl, "pct_nolink": nl / max(h, 1) * 100}
        print(f"{kind:14}{h:>10,}{h / n_place * 100:>9.2f}%{nl:>14,}"
              f"{nl / max(h, 1) * 100:>8.1f}%", file=sys.stderr)
    print(f"{'合計':14}{n_a:>10,}{n_a / n_place * 100:>9.2f}%{n_a_nolink:>14,}"
          f"{n_a_nolink / max(n_a, 1) * 100:>8.1f}%", file=sys.stderr)
    print(f"\n  よく当たったトークン上位20:", file=sys.stderr)
    for t, c in token_hits.most_common(20):
        print(f"    {t:22} {c:>7,}", file=sys.stderr)

    # --- B: 同一地点への集積（語彙に依存しない）---------------------------
    print(f"\n=== B. 半径50m に 5店以上が集まる塊（語彙に依存しない・上限寄り）===",
          file=sys.stderr)
    # 【自戒】最初は `measure_locality_backfill.cell_of`（0.01度 ≒ 1.1km）を流用した。
    # **半径 50m を訊いているのに 3×3 で約 3.3km 四方を舐めていた**ので、
    # 都心のセルでは1店あたり数千点と距離を計算していた。1.16M 件で 40分以上かかり、
    # セッションの中断で 86% のところで死んで**出力が1バイトも残らなかった**。
    # 0.001度 ≒ 110m なら 3×3 で ±110m を見ることになり、50m の判定に十分で、
    # 候補点は2桁減る。**問いの粒度に格子を合わせる。**
    CELL_B = 0.001
    RADIUS_M = 50.0

    def cell_b(lat: float, lon: float) -> tuple[int, int]:
        return (int(lat / CELL_B), int(lon / CELL_B))

    grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    for i, p in enumerate(plist):
        grid[cell_b(p["lat"], p["lon"])].append(i)
    print(f"  格子セル {len(grid):,}（{CELL_B}度 ≒ 110m）", file=sys.stderr)

    n_near = [0] * n_place
    for i, p in enumerate(plist):
        cy, cx = cell_b(p["lat"], p["lon"])
        lat, lon = p["lat"], p["lon"]
        c = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((cy + dy, cx + dx), ()):
                    q = plist[j]
                    if haversine_km(lat, lon, q["lat"], q["lon"]) * 1000 <= RADIUS_M:
                        c += 1
        n_near[i] = c
        if (i + 1) % 200000 == 0:
            print(f"  ... {i + 1:,}/{n_place:,}", file=sys.stderr)

    bands = ((5, 9), (10, 19), (20, 49), (50, 10**9))
    out_b = {}
    print(f"{'塊の大きさ':14}{'店数':>10}{'母集団比':>10}{'うちリンク無し':>14}{'その比':>9}",
          file=sys.stderr)
    n_b = n_b_nolink = 0
    for lo, hi in bands:
        idx = [i for i in range(n_place) if lo <= n_near[i] <= hi]
        nl = sum(1 for i in idx if not plist[i]["has_link"])
        lbl = f"{lo}-{hi}店" if hi < 10**8 else f"{lo}店以上"
        out_b[lbl] = {"n": len(idx), "pct_of_population": len(idx) / n_place * 100,
                      "n_nolink": nl}
        n_b += len(idx)
        n_b_nolink += nl
        print(f"{lbl:14}{len(idx):>10,}{len(idx) / n_place * 100:>9.2f}%{nl:>14,}"
              f"{nl / max(len(idx), 1) * 100:>8.1f}%", file=sys.stderr)
    print(f"{'合計(5店以上)':14}{n_b:>10,}{n_b / n_place * 100:>9.2f}%{n_b_nolink:>14,}"
          f"{n_b_nolink / max(n_b, 1) * 100:>8.1f}%", file=sys.stderr)

    # --- A と B の重なり ---------------------------------------------------
    a_set = set(kind_of)
    b_set = {i for i in range(n_place) if n_near[i] >= 5}
    inter = a_set & b_set
    print(f"\n=== A と B の重なり ===", file=sys.stderr)
    print(f"  A のみ {len(a_set - b_set):,} / B のみ {len(b_set - a_set):,} / "
          f"両方 {len(inter):,}", file=sys.stderr)
    print(f"  A のうち B にも入る割合: {len(inter) / max(len(a_set), 1) * 100:.1f}%"
          f"（屋号に施設名がある店は本当に集積しているか）", file=sys.stderr)
    union = a_set | b_set
    u_nolink = sum(1 for i in union if not plist[i]["has_link"])
    print(f"  **A∪B = {len(union):,} = 母集団の {len(union) / n_place * 100:.2f}%**"
          f"（うちリンク無し {u_nolink:,}）", file=sys.stderr)
    print(f"  リンク無し層 {n_nolink:,} に対する比: "
          f"{u_nolink / max(n_nolink, 1) * 100:.2f}%", file=sys.stderr)

    # --- 決定的な目視標本 ---------------------------------------------------
    import hashlib
    # 【自戒】`sorted` にタプルをそのまま渡したら、**同名店でハッシュが並んだときに
    # 第2要素の dict 同士を比較して TypeError** で落ちた。全部計算し終えた最後の1行で
    # 落ちたので、それまでの計算が丸ごと無駄になった。キーを明示する。
    sample = sorted(
        ((hashlib.sha256(plist[i]["name"].encode("utf-8")).hexdigest(),
          {"name": plist[i]["name"], "n_near": n_near[i],
           "kind": kind_of.get(i), "has_link": plist[i]["has_link"]})
         for i in union),
        key=lambda x: x[0])[:60]
    print(f"\n=== 決定的標本（A∪B から SHA-256 順 60件）===", file=sys.stderr)
    for _, s in sample[:20]:
        print(f"  {s['name'][:30]:32} 近傍{s['n_near']:>4}店 "
              f"{s['kind'] or '-':10} {'link' if s['has_link'] else 'nolink'}",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "facility_tenant.json"
    out_path.write_text(
        json.dumps({"n_rows": len(rows), "n_places": n_place, "n_nolink": n_nolink,
                    "vocab_route_A": out_a, "cluster_route_B": out_b,
                    "A_total": n_a, "B_total": n_b,
                    "union": len(union), "union_pct": len(union) / n_place * 100,
                    "union_nolink": u_nolink,
                    "union_nolink_pct_of_nolink": u_nolink / max(n_nolink, 1) * 100,
                    "sample": [s for _, s in sample],
                    "caveat": "ここで出したのは**母集団側の規模（経路存在率の分母）だけ**。"
                              "施設サイトに実際にその店の料理写真があるかは一切測っていない。"
                              "実効カバレッジをここから推定してはいけない。"
                              "A は手書き語彙なので下限、B は商店街や雑居ビルも混ざるので上限寄り。"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {out_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
