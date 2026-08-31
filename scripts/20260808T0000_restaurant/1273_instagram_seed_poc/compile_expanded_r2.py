#!/usr/bin/env python3
# #1273 インフルエンサー経路 handle 拡張ループ 第2周 (2026-08-31)
# 前周(compile_expanded.py)で 572 まで積んだ seed に、まとめ/セレクト記事と
# 「〈県〉グルメ 食べ歩き Instagram アカウント site:instagram.com」検索から
# 抽出したグルメインフルエンサー/媒体 handle を重複排除して追記する。
# 店舗公式・料理教室・自治体/観光連盟公式・純物販アカは抽出時に除外済み。
# 出力: out/influencer_handles_expanded_r2.json（ネット新規のみ）＋ 本番 txt へ追記。
import json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
TXT = os.path.abspath(os.path.join(HERE, "..", "sns_influencer_seed_handles.txt"))

def norm(h):
    h = h.strip().lower().lstrip("@")
    h = h.split("/")[0].split("?")[0].strip()
    return h.rstrip(".")

IG = "https://www.instagram.com/{}/"

# (handle, region, source_url)  region=日本語県名/エリア
# 出典URL: 検索由来は当該IGプロフィールURL、記事由来は記事URL
raw = [
    # --- 福島 ---
    ("fukushima_select","福島",IG.format("fukushima_select")),
    ("onomiway","福島",IG.format("onomiway")),
    ("m_____1023","福島",IG.format("m_____1023")),
    ("guruttoiwaki","福島",IG.format("guruttoiwaki")),
    ("umiusa_iwaki","福島",IG.format("umiusa_iwaki")),
    # --- 新潟 ---
    ("turuatu","新潟",IG.format("turuatu")),
    ("niigata_select","新潟",IG.format("niigata_select")),
    ("allniigata","新潟",IG.format("allniigata")),
    ("sumami_niigata","新潟",IG.format("sumami_niigata")),
    ("nonbiri0120","新潟",IG.format("nonbiri0120")),
    ("yui_m_2","新潟",IG.format("yui_m_2")),
    ("niigata_gourmet1","新潟",IG.format("niigata_gourmet1")),
    ("niigata_lunch","新潟",IG.format("niigata_lunch")),
    ("michiii73","新潟",IG.format("michiii73")),
    # --- 石川 ---
    ("kanazawa_miru","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("ishikawa.date.sena","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("ayag_rm","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("hakusan_gourmet","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("yohaku_ishikawa","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("gurumeshiba1020","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("soft_kun_kanazawa","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("kanazawa_gohan.cafe","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("kanazawa_cafe_issy","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("monkiti11_ishikawa_date","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("sakura_nkd","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("ishikawa.meshi_stagram","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("manpuku_kanazawa","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("hanaruka","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("kanazawa_puulog","石川","https://www.kanazawabiyori.com/special/influencer/"),
    ("gourmet_hide","石川","https://www.kanazawabiyori.com/special/influencer/"),
    # --- 福井 ---
    ("eice_fukui_cafe","福井","https://www.kanazawabiyori.com/special/influencer/"),
    ("riritoremon","福井",IG.format("riritoremon")),
    ("_fukui_gohan_","福井",IG.format("_fukui_gohan_")),
    ("fukuitravel","福井",IG.format("fukuitravel")),
    ("fukuieat","福井",IG.format("fukuieat")),
    # --- 三重 ---
    ("wappa_mie","三重",IG.format("wappa_mie")),
    ("mie_recommend_","三重",IG.format("mie_recommend_")),
    ("myari_guru","三重",IG.format("myari_guru")),
    ("miewalk_official","三重",IG.format("miewalk_official")),
    # --- 滋賀 ---
    ("shiga.meshi","滋賀",IG.format("shiga.meshi")),
    ("shiga.gohan","滋賀",IG.format("shiga.gohan")),
    ("marutto_shiga","滋賀",IG.format("marutto_shiga")),
    ("shiga._.gourmet","滋賀",IG.format("shiga._.gourmet")),
    ("shiga2.jp_f","滋賀",IG.format("shiga2.jp_f")),
    ("lomore.shiga","滋賀",IG.format("lomore.shiga")),
    # --- 山口 ---
    ("moshimoshi.kameyo","山口",IG.format("moshimoshi.kameyo")),
    ("rau_yamaguchi_gourmet","山口",IG.format("rau_yamaguchi_gourmet")),
    ("yamaguchi_spot","山口",IG.format("yamaguchi_spot")),
    ("yamaguchigurume","山口",IG.format("yamaguchigurume")),
    # --- 島根 ---
    ("shimane_trip","島根",IG.format("shimane_trip")),
    ("jimohack_shimane","島根",IG.format("jimohack_shimane")),
    ("chii_shimane","島根",IG.format("chii_shimane")),
    ("kids_spot_matsue_ichimama","島根",IG.format("kids_spot_matsue_ichimama")),
    # --- 山梨 ---
    ("h2k2sm3","山梨",IG.format("h2k2sm3")),
    ("yamanashi_foodielog","山梨",IG.format("yamanashi_foodielog")),
    ("yuki__yamanashi","山梨",IG.format("yuki__yamanashi")),
    # --- 青森 ---
    ("aomorinotabearuki","青森",IG.format("aomorinotabearuki")),
    ("ayumu._aomori","青森",IG.format("ayumu._aomori")),
    ("8meg031","青森",IG.format("8meg031")),
    ("taku_aomorigurume","青森",IG.format("taku_aomorigurume")),
    ("aomori_gohan30","青森",IG.format("aomori_gohan30")),
    ("aomori.umaimeshi","青森",IG.format("aomori.umaimeshi")),
    ("aka_kingyo","青森",IG.format("aka_kingyo")),
    ("harapekoaomori","青森",IG.format("harapekoaomori")),
    ("myfavoritefoodsinaomori","青森",IG.format("myfavoritefoodsinaomori")),
    # --- 香川 ---
    ("debumaru88","香川",IG.format("debumaru88")),
    ("udonken_kagawa","香川",IG.format("udonken_kagawa")),
    ("mikina_udonmap","香川",IG.format("mikina_udonmap")),
    # --- 愛媛 ---
    ("ehime_select","愛媛",IG.format("ehime_select")),
    ("tititoko_ehime","愛媛",IG.format("tititoko_ehime")),
    ("mogu_uou_mogu","愛媛",IG.format("mogu_uou_mogu")),
    # --- 徳島 ---
    ("tokushima__food","徳島",IG.format("tokushima__food")),
    ("tokushima_student","徳島",IG.format("tokushima_student")),
    ("puraneterina","徳島",IG.format("puraneterina")),
    # --- 高知 ---
    ("kochi_select","高知",IG.format("kochi_select")),
    ("repkochi","高知",IG.format("repkochi")),
    ("iwalk_kochi","高知",IG.format("iwalk_kochi")),
    # --- 佐賀 ---
    ("saga_select","佐賀",IG.format("saga_select")),
    ("ryoma.gurume","佐賀",IG.format("ryoma.gurume")),
    ("sagalunch","佐賀",IG.format("sagalunch")),
    ("yui_ca.sggm","佐賀",IG.format("yui_ca.sggm")),
    # --- 宮崎 ---
    ("gourmet.miyazaki","宮崎",IG.format("gourmet.miyazaki")),
    ("miyazaki_select","宮崎",IG.format("miyazaki_select")),
    ("tegeumajin","宮崎",IG.format("tegeumajin")),
    ("ymlunch","宮崎",IG.format("ymlunch")),
    ("eisei_96","宮崎",IG.format("eisei_96")),
    # --- 大分 ---
    ("sho_gourmet","大分",IG.format("sho_gourmet")),
    ("oitasakaba_horoki","大分",IG.format("oitasakaba_horoki")),
    ("oishii.oita","大分",IG.format("oishii.oita")),
    ("19870501kk","大分",IG.format("19870501kk")),
    # --- 鳥取 ---
    ("tottoricafe_tabesyo","鳥取",IG.format("tottoricafe_tabesyo")),
    ("tottori_gourmet_report","鳥取",IG.format("tottori_gourmet_report")),
    ("tottori_._gourmet","鳥取",IG.format("tottori_._gourmet")),
    ("tory_spot","鳥取",IG.format("tory_spot")),
    ("oishi_tottori","鳥取",IG.format("oishi_tottori")),
    # --- 沖縄 ---
    ("okinawa_gurmet_news","沖縄",IG.format("okinawa_gurmet_news")),
    ("gachimai_tank","沖縄",IG.format("gachimai_tank")),
    # --- 秋田 ---
    ("akitakanko_","秋田",IG.format("akitakanko_")),
    # --- 栃木 ---
    ("tabe_rog","栃木",IG.format("tabe_rog")),
    ("utsunomiya_kurashi","栃木",IG.format("utsunomiya_kurashi")),
    ("gatturi_gourmet_tochigi","栃木",IG.format("gatturi_gourmet_tochigi")),
    ("miya_tabe","栃木",IG.format("miya_tabe")),
    ("erika_uma","栃木",IG.format("erika_uma")),
    ("tekumeshi","栃木",IG.format("tekumeshi")),
    ("_____s.a.y","栃木",IG.format("_____s.a.y")),
    # --- 茨城 ---
    ("ibaraki.food","茨城",IG.format("ibaraki.food")),
    ("ibaraki_lunch","茨城",IG.format("ibaraki_lunch")),
    ("ibaraki_dai","茨城",IG.format("ibaraki_dai")),
    ("ryoma_gulme","茨城",IG.format("ryoma_gulme")),
    ("manpukuhuhu","茨城",IG.format("manpukuhuhu")),
    # --- 岡山 ---
    ("okayama_select","岡山",IG.format("okayama_select")),
    ("okayama_kattenitabelog","岡山",IG.format("okayama_kattenitabelog")),
    ("food_okayama","岡山",IG.format("food_okayama")),
    # --- 熊本 ---
    ("kumayachi_gourmet","熊本",IG.format("kumayachi_gourmet")),
    ("naocham0816","熊本",IG.format("naocham0816")),
    ("1tansuikabutsu","熊本",IG.format("1tansuikabutsu")),
    ("aso_gourmet","熊本",IG.format("aso_gourmet")),
    ("kensome_kumamoto","熊本",IG.format("kensome_kumamoto")),
    ("ken_ogata_22","熊本",IG.format("ken_ogata_22")),
    ("miki_prfm","熊本",IG.format("miki_prfm")),
    # --- 鹿児島 ---
    ("kagoking2","鹿児島",IG.format("kagoking2")),
    ("linghe669","鹿児島",IG.format("linghe669")),
    ("kagoshima_cafe","鹿児島",IG.format("kagoshima_cafe")),
    ("kadai_info","鹿児島",IG.format("kadai_info")),
    ("popo_kyushu","鹿児島",IG.format("popo_kyushu")),
    ("kagoshima_no1_foods","鹿児島",IG.format("kagoshima_no1_foods")),
    ("kagocafe09","鹿児島",IG.format("kagocafe09")),
    # --- 長崎 ---
    ("nagasakifukucyan","長崎",IG.format("nagasakifukucyan")),
    ("ayakovskii","長崎",IG.format("ayakovskii")),
    ("cmma312","長崎",IG.format("cmma312")),
    ("sanalunch_nagasaki","長崎",IG.format("sanalunch_nagasaki")),
    # --- 静岡 ---
    ("rubypink724","静岡",IG.format("rubypink724")),
    ("cafe_hama","静岡",IG.format("cafe_hama")),
    ("eating_tour_in_enshu","静岡",IG.format("eating_tour_in_enshu")),
    ("aya.gu_ru","静岡",IG.format("aya.gu_ru")),
    ("hamamatsu_gourmeee","静岡",IG.format("hamamatsu_gourmeee")),
    # --- 富山 ---
    ("2654aki","富山",IG.format("2654aki")),
    ("yukiyuki_ya","富山",IG.format("yukiyuki_ya")),
    ("toyama_gurume","富山",IG.format("toyama_gurume")),
    ("toieba_toyama","富山",IG.format("toieba_toyama")),
    ("nannan_toyama","富山",IG.format("nannan_toyama")),
    # --- 岐阜 ---
    ("gifu_info","岐阜",IG.format("gifu_info")),
    ("mg2mmk","岐阜",IG.format("mg2mmk")),
    ("gifu_gourmet","岐阜",IG.format("gifu_gourmet")),
    # --- 長野 ---
    ("matsumotoshi_gourmet","長野",IG.format("matsumotoshi_gourmet")),
    ("infoyami2ki","長野",IG.format("infoyami2ki")),
    ("naganoken_gurume","長野",IG.format("naganoken_gurume")),
    ("gohan_suwa","長野",IG.format("gohan_suwa")),
    ("hahahaishya","長野",IG.format("hahahaishya")),
    # --- 宮城 ---
    ("toy8factory","宮城",IG.format("toy8factory")),
    ("hoshi_mittsudesu","宮城",IG.format("hoshi_mittsudesu")),
    ("eatmapsendai","宮城",IG.format("eatmapsendai")),
    ("sendai_gurume2022","宮城",IG.format("sendai_gurume2022")),
    ("ke_____i33","宮城",IG.format("ke_____i33")),
    # --- 山形 ---
    ("pocchari_nu","山形",IG.format("pocchari_nu")),
    # --- 岩手 ---
    ("428studio","岩手",IG.format("428studio")),
    ("morioka_gourmet_","岩手",IG.format("morioka_gourmet_")),
    ("moriokadegohan","岩手",IG.format("moriokadegohan")),
    ("japan_foods_iwate_kitakami","岩手",IG.format("japan_foods_iwate_kitakami")),
    # --- 福岡 ---
    ("gaburi_gaburi","福岡",IG.format("gaburi_gaburi")),
    ("mosaostyle","福岡",IG.format("mosaostyle")),
    ("fukuokagohan_","福岡",IG.format("fukuokagohan_")),
    ("chiko12_gourmet","福岡",IG.format("chiko12_gourmet")),
    ("masaki.gurume","福岡",IG.format("masaki.gurume")),
    ("fuk_gourmet_arisa","福岡",IG.format("fuk_gourmet_arisa")),
    ("fukuoka_gurumerepo","福岡",IG.format("fukuoka_gurumerepo")),
    ("fukuoka_gourmet_guide","福岡",IG.format("fukuoka_gourmet_guide")),
    # --- 愛知 ---
    ("nagoya.mj","愛知",IG.format("nagoya.mj")),
    ("nagoya_hiro_gourmet","愛知",IG.format("nagoya_hiro_gourmet")),
    ("trend_gourmet","愛知",IG.format("trend_gourmet")),
    ("yuichi5016","愛知",IG.format("yuichi5016")),
    ("nagoya_food","愛知",IG.format("nagoya_food")),
    ("nagoya_sweetsgourmet","愛知",IG.format("nagoya_sweetsgourmet")),
    # --- 兵庫 ---
    ("kobeguru","兵庫",IG.format("kobeguru")),
    ("hyogo_kobegurume_tabearuki","兵庫",IG.format("hyogo_kobegurume_tabearuki")),
    ("gourmet.na_hyogo","兵庫",IG.format("gourmet.na_hyogo")),
    ("hyogo.gurume","兵庫",IG.format("hyogo.gurume")),
    ("genic_kobe","兵庫",IG.format("genic_kobe")),
    ("cafe.to.gourmet","兵庫",IG.format("cafe.to.gourmet")),
    # --- 京都 ---
    ("leaf_kyoto","京都",IG.format("leaf_kyoto")),
    ("kon.kyototrip","京都",IG.format("kon.kyototrip")),
    ("kyoto_tabetoku","京都",IG.format("kyoto_tabetoku")),
    ("kyotopi","京都",IG.format("kyotopi")),
    ("kyoto_bishoku_meguri","京都",IG.format("kyoto_bishoku_meguri")),
    # --- 北海道 ---
    ("hokkaido_food_tours","北海道",IG.format("hokkaido_food_tours")),
    ("kitagohan_insta","北海道",IG.format("kitagohan_insta")),
    ("sapporo_gourmet_","北海道",IG.format("sapporo_gourmet_")),
    # --- 埼玉 ---
    ("miyahara_media","埼玉",IG.format("miyahara_media")),
    ("omiyagourmet","埼玉",IG.format("omiyagourmet")),
    ("gurume_saitama2","埼玉",IG.format("gurume_saitama2")),
    ("saitamatamako","埼玉",IG.format("saitamatamako")),
    ("saitama_bongurume","埼玉",IG.format("saitama_bongurume")),
    ("chiiii_cafe_","埼玉",IG.format("chiiii_cafe_")),
    # --- 群馬 ---
    ("tmk_10.01_","群馬",IG.format("tmk_10.01_")),
    ("tomarupenki","群馬",IG.format("tomarupenki")),
    ("kzy_gourmet","群馬",IG.format("kzy_gourmet")),
    # --- 大阪 ---
    ("macky565656","大阪",IG.format("macky565656")),
    ("osaka.gurugurume","大阪",IG.format("osaka.gurugurume")),
    ("man_puku_gourmet","大阪",IG.format("man_puku_gourmet")),
    ("osaka.food.07","大阪",IG.format("osaka.food.07")),
    ("osaka._.gourmet","大阪",IG.format("osaka._.gourmet")),
    ("osaka.gourmet","大阪",IG.format("osaka.gourmet")),
    ("osakagourmet4","大阪",IG.format("osakagourmet4")),
    # --- 千葉 ---
    ("chiba.drive.walk","千葉",IG.format("chiba.drive.walk")),
    ("funabashi_gurume","千葉",IG.format("funabashi_gurume")),
    ("konchi_odekake_","千葉",IG.format("konchi_odekake_")),
    ("gogo.chiba","千葉",IG.format("gogo.chiba")),
    # --- 神奈川 ---
    ("kanagawagourmet1","神奈川",IG.format("kanagawagourmet1")),
    ("kanagawa_gourmet_trip","神奈川",IG.format("kanagawa_gourmet_trip")),
    ("sugar_yokohama_gourmet","神奈川",IG.format("sugar_yokohama_gourmet")),
    ("yokohama_cosper_gourmet","神奈川",IG.format("yokohama_cosper_gourmet")),
]

EXCLUDE = set()

base = set(norm(l) for l in open(TXT, encoding="utf-8") if l.strip())

seen = {}
for h, region, src in raw:
    n = norm(h)
    if not n or n in EXCLUDE or n in seen:
        continue
    seen[n] = {"handle": n, "region": region, "source_url": src}

new = {h: v for h, v in seen.items() if h not in base}

expanded = sorted(new.values(), key=lambda x: x["handle"])
out_path = os.path.join(HERE, "out", "influencer_handles_expanded_r2.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(expanded, f, ensure_ascii=False, indent=2)

merged = sorted(base | set(new.keys()))
with open(TXT, "w", encoding="utf-8") as f:
    f.write("\n".join(merged) + "\n")

regions = Counter(v["region"] for v in new.values())
print(f"collected distinct (this loop): {len(seen)}")
print(f"already in base (dup):          {len(seen)-len(new)}")
print(f"NET NEW:                        {len(new)}")
print(f"base -> new txt total:          {len(merged)}")
print(f"region buckets: {len(regions)}")
for r, c in regions.most_common():
    print(f"  {r}: {c}")
