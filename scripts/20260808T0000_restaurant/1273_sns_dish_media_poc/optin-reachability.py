#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
#1273 optin-reachability : 店舗オプトイン / ユーザー投稿で 48%→70% の22ptを埋められるかの定量化

# #1273 【設計】これは技術PoCではなく到達可能性の定量化。
#   「オプトインすれば解決する」は自明なので結論にしない。
#   「何店に声をかけ、何%が応じる必要があるか」を実測の分母で出す。
#
# #1273 【仕様】測るもの
#   1. 連絡可能性: /tmp/overture-jp.parquet 全件で phone/email/website/socials 充足率
#      (D0=789,612 と D2=dish_strict 589,782 の両方)
#   2. 22pt = 何店か (D0/D2)
#   3. 必要オプトイン率 = 必要店数 / (未カバー かつ 連絡可能 な店数)
#   4. ユーザー投稿側の逆算 (1店あたり投稿数 → 必要MAU)
#   5. 既に dish_media を持つ店(YouTube/自社サイト)と連絡可能な店の重複を
#      同じ600店サンプルで実測。補完的でなければ22ptは埋まらない。
#
# #1273 【仕様】分母の注意
#   オプトインの対象は「まだカバーされていない店」だけである。
#   既にカバー済みの店に声をかけてもカバレッジは1ptも動かない。
#   よって必要オプトイン率の分母は 全店ではなく 未カバー∩連絡可能 とする。
"""
import hashlib
import json
import os
import re
from datetime import datetime, timezone

import duckdb

BASE = os.path.dirname(os.path.abspath(__file__))
PARQUET = "/tmp/overture-jp.parquet"
SAMPLE = os.path.join(BASE, "out", "supply_ceiling_2026-08-13.json")
OWNSITE = os.path.join(BASE, "out", "own-website-images.json")
OUT = os.path.join(BASE, "out", "optin-reachability.json")

FOOD_WHERE = ("where addresses[1].country='JP' "
              "AND list_contains(taxonomy.hierarchy,'food_and_drink')")

# population-audit.py と同一の dish カテゴリ定義（D2 = strict）
CAT_DISH_CORE = {"restaurant", "casual_eatery", "fast_food_restaurant"}
CAT_GRAY = {"bar", "cafe", "coffee_shop", "non_alcoholic_beverage_venue",
            "lounge", "smoothie_juice_bar"}
PRIMARY_RESCUE = {"sake_bar", "pub", "diner", "delicatessen", "bakery",
                  "desserts", "ice_cream_shop", "donuts", "hong_kong_style_cafe"}

_core = ",".join(f"'{c}'" for c in CAT_DISH_CORE)
_gray = ",".join(f"'{c}'" for c in CAT_GRAY)
_rescue = ",".join(f"'{c}'" for c in PRIMARY_RESCUE)
DISH_STRICT = (f"(basic_category in ({_core}) "
               f" or (basic_category in ({_gray}) and categories.primary in ({_rescue})))")

# #1273 【仕様】既知の実測ベースライン（同一600店サンプル）
BASELINE_UNION_PCT = 48.0     # 無料かつ規約クリーンな合算天井(経路ベース)
TARGET_PCT = 70.0
GAP_PT = TARGET_PCT - BASELINE_UNION_PCT

# #1273 【仕様】ポータル(食べログ等)ドメインは「自社サイト」ではない。#1304 と同じ判定。
PORTAL_RE = re.compile(
    r"(tabelog|gurunavi|gnavi|hotpepper|recruit|ekiten|retty|hitosara|ikyu|"
    r"facebook|instagram|twitter|x\.com|tiktok|youtube|line\.me|goo\.ne|"
    r"jimdo|wixsite|amebaownd|ameblo|hatenablog|localplace|navitime|mapion|"
    r"epark|toreta|tablecheck|autoreserve|yahoo|google)", re.I)


def sha_rank(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def main():
    con = duckdb.connect()
    q = lambda sql: con.execute(sql).fetchall()
    res = {"generated_at": datetime.now(timezone.utc).isoformat(),
           "slug": "optin-reachability"}

    # ---------------------------------------------------------------
    # 1. 連絡可能性の実測（全件）
    # ---------------------------------------------------------------
    # #1273 【バグ】websites/socials/phones/emails は VARCHAR[]。NULL と空配列の両方がある。
    def fill_sql(where_extra: str) -> str:
        return f"""
        select
          count(*) as n,
          sum(case when len(coalesce(phones,[]))>0 then 1 else 0 end) as n_phone,
          sum(case when len(coalesce(emails,[]))>0 then 1 else 0 end) as n_email,
          sum(case when len(coalesce(websites,[]))>0 then 1 else 0 end) as n_web,
          sum(case when len(coalesce(socials,[]))>0 then 1 else 0 end) as n_social,
          sum(case when len(coalesce(phones,[]))>0 or len(coalesce(emails,[]))>0
                   then 1 else 0 end) as n_phone_or_email,
          sum(case when len(coalesce(phones,[]))>0 or len(coalesce(emails,[]))>0
                        or len(coalesce(websites,[]))>0
                   then 1 else 0 end) as n_direct_any,
          sum(case when len(coalesce(phones,[]))>0 or len(coalesce(emails,[]))>0
                        or len(coalesce(websites,[]))>0 or len(coalesce(socials,[]))>0
                   then 1 else 0 end) as n_any,
          sum(case when len(coalesce(phones,[]))=0 and len(coalesce(emails,[]))=0
                        and len(coalesce(websites,[]))=0 and len(coalesce(socials,[]))=0
                   then 1 else 0 end) as n_none
        from '{PARQUET}' {FOOD_WHERE} {where_extra}
        """

    cols = ["n", "n_phone", "n_email", "n_web", "n_social",
            "n_phone_or_email", "n_direct_any", "n_any", "n_none"]
    reach = {}
    for key, extra in (("D0_all_food", ""), ("D2_dish_strict", f"and {DISH_STRICT}")):
        row = q(fill_sql(extra))[0]
        d = dict(zip(cols, [int(x or 0) for x in row]))
        n = d["n"]
        d_pct = {k + "_pct": round(100.0 * v / n, 2) for k, v in d.items() if k != "n"}
        reach[key] = {**d, **d_pct}
    res["reachability"] = reach

    # socials の内訳（どのSNSにオプトイン導線を張れるか）
    soc = q(f"""
        select case
                 when lower(s) like '%facebook.com%' then 'facebook'
                 when lower(s) like '%instagram.com%' then 'instagram'
                 when lower(s) like '%twitter.com%' or lower(s) like '%//x.com%' then 'x'
                 when lower(s) like '%tiktok.com%' then 'tiktok'
                 when lower(s) like '%line.me%' then 'line'
                 else 'other' end as k,
               count(distinct id) as n
        from (select id, unnest(socials) as s from '{PARQUET}' {FOOD_WHERE})
        group by 1 order by n desc""")
    tot0 = reach["D0_all_food"]["n"]
    res["socials_breakdown_D0"] = [
        {"platform": k, "n_stores": int(n), "pct": round(100.0 * n / tot0, 2)} for k, n in soc]

    # website のうち自社ドメイン（オプトイン依頼のメールフォームが期待できる先）
    web_own = q(f"""
        select count(distinct id) from (
          select id, unnest(websites) as w from '{PARQUET}' {FOOD_WHERE}
        ) where not regexp_matches(lower(w),
          '(tabelog|gurunavi|gnavi|hotpepper|recruit|ekiten|retty|hitosara|ikyu|facebook|instagram|twitter|tiktok|youtube|line\\.me|goo\\.ne|jimdo|wixsite|amebaownd|ameblo|hatenablog|localplace|navitime|mapion|epark|toreta|tablecheck|autoreserve|yahoo|google)')
    """)[0][0]
    res["reachability"]["D0_all_food"]["n_web_own_domain"] = int(web_own)
    res["reachability"]["D0_all_food"]["n_web_own_domain_pct"] = round(100.0 * web_own / tot0, 2)

    # #1273 【設計】無料でオプトイン依頼を届けられる導線 = email or 自社ドメインサイト
    PORTAL_SQL = ("(tabelog|gurunavi|gnavi|hotpepper|recruit|ekiten|retty|hitosara|ikyu|"
                  "facebook|instagram|twitter|tiktok|youtube|line\\\\.me|goo\\\\.ne|jimdo|"
                  "wixsite|amebaownd|ameblo|hatenablog|localplace|navitime|mapion|epark|"
                  "toreta|tablecheck|autoreserve|yahoo|google)")
    for key, extra in (("D0_all_food", ""), ("D2_dish_strict", f"and {DISH_STRICT}")):
        n_free = q(f"""
            select count(*) from (
              select id, len(coalesce(emails,[]))>0 as has_mail,
                     coalesce(list_bool_or(not regexp_matches(lower(w),'{PORTAL_SQL}')), false) as own_web
              from (select id, emails, unnest(coalesce(websites,[null])) as w
                    from '{PARQUET}' {FOOD_WHERE} {extra})
              group by id, has_mail
            ) where has_mail or own_web""")[0][0]
        nn = res["reachability"][key]["n"]
        res["reachability"][key]["n_free_outreach_email_or_own_site"] = int(n_free)
        res["reachability"][key]["n_free_outreach_pct"] = round(100.0 * n_free / nn, 2)

    # ---------------------------------------------------------------
    # 2. 22pt = 何店か
    # ---------------------------------------------------------------
    gap = {}
    for key in ("D0_all_food", "D2_dish_strict"):
        n = reach[key]["n"]
        gap[key] = {
            "population": n,
            "gap_pt": GAP_PT,
            "stores_needed_for_22pt": int(round(n * GAP_PT / 100.0)),
            "currently_covered_est": int(round(n * BASELINE_UNION_PCT / 100.0)),
            "uncovered_est": int(round(n * (100.0 - BASELINE_UNION_PCT) / 100.0)),
        }
    res["gap_in_stores"] = gap

    # ---------------------------------------------------------------
    # 5. 重複の実測（600店サンプル）— 先にこれを出す。分母に効くため。
    # ---------------------------------------------------------------
    sample = json.load(open(SAMPLE))["results"]
    yt_hit = {r["restaurant"]["id"]: bool(r.get("hit")) for r in sample}
    ids = list(yt_hit.keys())

    own = json.load(open(OWNSITE))["results"]
    # #1273 【バグ】既知の合算天井 48.0% は「経路ベース」(YouTube生 ∪ 自社ドメイン保有)。
    #   検証済み画像ベース(15.33%)で数えると union は 43.0% になり、22ptの分母とズレる。
    #   gap を 48.0 起点で計算している以上、重複表も経路ベースで揃える。
    own_path = {r["id"]: (not r.get("is_portal", True)) for r in own}
    own_verified = {r["id"]: (r.get("n_verified_dish", 0) or 0) > 0 for r in own}

    # 600店の連絡先を parquet から引く
    idlist = ",".join("'" + i.replace("'", "''") + "'" for i in ids)
    rows = q(f"""
        select id,
               len(coalesce(phones,[]))>0, len(coalesce(emails,[]))>0,
               len(coalesce(websites,[]))>0, len(coalesce(socials,[]))>0,
               {DISH_STRICT}, coalesce(websites,[])
        from '{PARQUET}' where id in ({idlist})""")
    contact = {}
    for r in rows:
        ws = list(r[6] or [])
        contact[r[0]] = {
            "phone": bool(r[1]), "email": bool(r[2]),
            "web": bool(r[3]), "social": bool(r[4]),
            "dish_strict": bool(r[5]),
            # #1273 【設計】ポータル/SNSドメインは「オプトイン依頼を届ける導線」にならない。
            #   ポータルは #1303 で営利目的アクセス自体が禁止。自社ドメインのみを数える。
            "web_own": any(not PORTAL_RE.search(w or "") for w in ws),
        }
    res["sample_matched_in_parquet"] = len(contact)

    EMPTY = {"phone": False, "email": False, "web": False, "social": False, "web_own": False}

    def cflags(i):
        return contact.get(i, EMPTY)

    # クロス表: 既カバー(48.0%の経路ベース) × 連絡可能
    # #1273 【設計】free_outreach = メール or 自社ドメインサイト。
    #   phone はテレアポ(=人件費)、facebook DM は Meta のゲートと規約に依存するため
    #   「無料のみ」の鉄則を満たす導線とは言えない。別枠で数える。
    tab = {}
    for reach_key, fn in (
        ("free_outreach_email_or_own_site", lambda c: c["email"] or c["web_own"]),
        ("phone_or_email", lambda c: c["phone"] or c["email"]),
        ("phone_email_or_web", lambda c: c["phone"] or c["email"] or c["web"]),
        ("any_incl_social", lambda c: c["phone"] or c["email"] or c["web"] or c["social"]),
    ):
        cnt = {"covered_and_reach": 0, "covered_not_reach": 0,
               "uncovered_and_reach": 0, "uncovered_not_reach": 0}
        for i in ids:
            covered = yt_hit[i] or own_path.get(i, False)
            r_ = fn(cflags(i))
            cnt[("covered" if covered else "uncovered") + ("_and_reach" if r_ else "_not_reach")] += 1
        n = len(ids)
        cov = cnt["covered_and_reach"] + cnt["covered_not_reach"]
        unc = cnt["uncovered_and_reach"] + cnt["uncovered_not_reach"]
        tab[reach_key] = {
            **cnt,
            "n": n,
            "covered_pct": round(100.0 * cov / n, 2),
            "reach_pct_overall": round(100.0 * (cnt["covered_and_reach"] + cnt["uncovered_and_reach"]) / n, 2),
            "reach_pct_among_covered": round(100.0 * cnt["covered_and_reach"] / cov, 2) if cov else None,
            "reach_pct_among_uncovered": round(100.0 * cnt["uncovered_and_reach"] / unc, 2) if unc else None,
            "uncovered_and_reach_pct_of_600": round(100.0 * cnt["uncovered_and_reach"] / n, 2),
        }
        # #1273 【設計】補完性の指標: 未カバー店の連絡可能率 / カバー済み店の連絡可能率
        #   1.0 なら独立（完全に補完的）、<1 なら「取れてない店ほど連絡先も無い」
        if cov and unc and cnt["covered_and_reach"]:
            tab[reach_key]["complementarity_ratio"] = round(
                (cnt["uncovered_and_reach"] / unc) / (cnt["covered_and_reach"] / cov), 3)
    res["overlap_600"] = tab

    # ---------------------------------------------------------------
    # 3. 必要オプトイン率の逆算
    # ---------------------------------------------------------------
    # #1273 【設計】分母 = 母集団 × P(未カバー ∩ 連絡可能)  ← 600店の実測比率を使う
    optin = {}
    for pop_key in ("D0_all_food", "D2_dish_strict"):
        N = reach[pop_key]["n"]
        need = gap[pop_key]["stores_needed_for_22pt"]
        per = {}
        for reach_key, t in tab.items():
            p = t["uncovered_and_reach_pct_of_600"] / 100.0
            pool = int(round(N * p))
            per[reach_key] = {
                "addressable_pool": pool,
                "stores_needed": need,
                "required_optin_rate_pct": round(100.0 * need / pool, 2) if pool else None,
            }
        optin[pop_key] = per
    res["required_optin_rate"] = optin

    # #1273 【仕様】オプトインした店が実際に dish_media を出せるとは限らない。
    #   歩留まり(店が使える料理写真を実際に提供する率) y を掛けると必要率は 1/y 倍になる。
    key_pool = optin["D2_dish_strict"]["free_outreach_email_or_own_site"]["addressable_pool"]
    key_need = optin["D2_dish_strict"]["free_outreach_email_or_own_site"]["stores_needed"]
    res["yield_sensitivity_D2_free_outreach"] = [
        {"media_supply_yield": y,
         "required_optin_rate_pct": round(100.0 * key_need / (key_pool * y), 2)}
        for y in (1.0, 0.8, 0.6, 0.4)
    ]

    # ---------------------------------------------------------------
    # 4. ユーザー投稿側の逆算
    # ---------------------------------------------------------------
    # #1273 【仕様】1店を publish 可能にするのに必要な dish_media 件数 k を振る。
    #   投稿は店舗に一様には分散しない。実サービスの UGC はロングテールになり、
    #   人気店に集中する。ここでは (a) 完全一様 と (b) Zipf(s=1.0) の2条件で出す。
    ugc = {}
    for pop_key in ("D0_all_food", "D2_dish_strict"):
        N = reach[pop_key]["n"]
        need = gap[pop_key]["stores_needed_for_22pt"]
        per_k = {}
        for k in (1, 3, 5):
            posts_uniform = need * k
            # Zipf: 上位 need 店をカバーするのに必要な総投稿数。
            # rank r の店の投稿シェア ∝ 1/r。上位 need 店が k 件以上を得るには
            # 最下位(rank=need)の店が k 件必要 → 総投稿 T は
            # T * (1/need) / H(N) >= k  →  T >= k * need * H(N)
            H = 0.0
            # 調和数の近似（オイラー・マスケローニ）
            import math
            H = math.log(N) + 0.5772156649 + 1.0 / (2 * N)
            posts_zipf = int(round(k * need * H))
            per_k[f"k={k}"] = {
                "posts_uniform": posts_uniform,
                "posts_zipf_s1": posts_zipf,
                "zipf_multiplier": round(posts_zipf / posts_uniform, 1),
            }
        ugc[pop_key] = per_k
    res["ugc_posts_needed"] = ugc

    # #1273 【仕様】必要MAUの逆算。
    #   90-9-1 の法則: MAU のうち投稿する層は 1%(保守) 〜 9%(楽観)。
    #   投稿者1人あたり月間投稿数 p を 1 / 3 で振る。12ヶ月で積み上げる想定。
    need_posts = ugc["D2_dish_strict"]["k=3"]["posts_uniform"]
    need_posts_zipf = ugc["D2_dish_strict"]["k=3"]["posts_zipf_s1"]
    mau = []
    for contributor_rate in (0.01, 0.05, 0.09):
        for posts_per_contributor_month in (1, 3):
            for months in (12, 36):
                cap = contributor_rate * posts_per_contributor_month * months
                mau.append({
                    "contributor_rate": contributor_rate,
                    "posts_per_contributor_month": posts_per_contributor_month,
                    "months": months,
                    "required_mau_uniform": int(round(need_posts / cap)),
                    "required_mau_zipf_s1": int(round(need_posts_zipf / cap)),
                })
    res["required_mau_D2_k3"] = {
        "posts_needed_uniform": need_posts,
        "posts_needed_zipf_s1": need_posts_zipf,
        "scenarios": mau,
    }

    # ---------------------------------------------------------------
    # 業界統計（外部・出典付き。実測ではないことを明示）
    # ---------------------------------------------------------------
    res["industry_benchmarks_external"] = {
        "note": "外部の公開ベンチマーク。本PoCの実測値ではない。比較評価のためだけに用いる。",
        "cold_email_reply_rate_pct": {
            "typical_range": [1.0, 5.0], "average_2025": [7.0, 10.0],
            "top_performers": 15.0,
            "sources": ["https://instantly.ai/blog/cold-email-reply-rate-benchmarks/",
                        "https://belkins.io/blog/cold-email-response-rates",
                        "https://www.salescaptain.io/blog/cold-email-statistics"],
        },
        "note_reply_vs_signup": "reply rate は『返信率』であり、実際に連携作業まで完了する率(=オプトイン成立率)は "
                                "その一部にすぎない。SMB向けセルフサーブ登録の完了率は通常 reply rate を下回る。",
    }

    json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items()
                      if k in ("reachability", "gap_in_stores", "overlap_600",
                               "required_optin_rate", "yield_sensitivity_D2_any")},
                     ensure_ascii=False, indent=1))
    print("---- ugc ----")
    print(json.dumps({"ugc": res["ugc_posts_needed"], "mau": res["required_mau_D2_k3"]},
                     ensure_ascii=False, indent=1))
    print("socials:", json.dumps(res["socials_breakdown_D0"], ensure_ascii=False))
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
