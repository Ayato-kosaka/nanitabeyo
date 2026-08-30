#!/usr/bin/env python3
# #1273 インフルエンサー経路 handle 拡張ループ (2026-08-30)
# 記事/検索から抽出したグルメインフルエンサー handle を既存 413 と重複排除し、
# ネット新規を out/influencer_handles_expanded.json と本番 txt へ書き出す。
import json, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
TXT = os.path.abspath(os.path.join(HERE, "..", "sns_influencer_seed_handles.txt"))

def norm(h):
    h = h.strip().lower().lstrip("@")
    h = h.split("/")[0].split("?")[0].strip()
    h = h.rstrip(".")
    return h

# 出典URL: 検索由来は当該IGプロフィールURL、記事由来は記事URL
IG = "https://www.instagram.com/{}/"

# (handle, region, source_url)  region は日本語県名/エリア
raw = [
    # --- 秋田 (search) ---
    ("mecci_akita_official","秋田",IG.format("mecci_akita_official")),
    ("akita_tabenikki","秋田",IG.format("akita_tabenikki")),
    # --- 福井 (search) ---
    ("fukui_foodie","福井",IG.format("fukui_foodie")),
    ("fukublo","福井",IG.format("fukublo")),
    ("nojinojik","福井",IG.format("nojinojik")),
    ("fukuifood","福井",IG.format("fukuifood")),
    ("eri.xcx","福井",IG.format("eri.xcx")),
    ("tksysd_fukui","福井",IG.format("tksysd_fukui")),
    ("yumino_of_fukui","福井",IG.format("yumino_of_fukui")),
    # --- 青森/岩手 (search) ---
    ("marugotoaomori","青森",IG.format("marugotoaomori")),
    ("iwate__select","岩手",IG.format("iwate__select")),
    ("iwate_no_gourmet","岩手",IG.format("iwate_no_gourmet")),
    ("iwatenogohan","岩手",IG.format("iwatenogohan")),
    ("yanagi_gurume","岩手",IG.format("yanagi_gurume")),
    ("hachiguru_chan","青森",IG.format("hachiguru_chan")),
    ("rikuzentakata_kankou","岩手",IG.format("rikuzentakata_kankou")),
    ("iwate_kuishinbo","岩手",IG.format("iwate_kuishinbo")),
    ("iwate_kuishinbolunch","岩手",IG.format("iwate_kuishinbolunch")),
    # --- 山形 (search) ---
    ("yamagata_gurumechan","山形",IG.format("yamagata_gurumechan")),
    ("arift_yamagata","山形",IG.format("arift_yamagata")),
    ("yamagata.cafe.jp","山形",IG.format("yamagata.cafe.jp")),
    ("mirarch_yamagata","山形",IG.format("mirarch_yamagata")),
    ("zizi.sinjo.yamagata","山形",IG.format("zizi.sinjo.yamagata")),
    ("yamagata_shin","山形",IG.format("yamagata_shin")),
    ("yamagata___cafe","山形",IG.format("yamagata___cafe")),
    ("yamagatagurashi","山形",IG.format("yamagatagurashi")),
    ("yamagata_chan","山形",IG.format("yamagata_chan")),
    # --- 香川/徳島/四国 (search) ---
    ("noko_kagawa","香川",IG.format("noko_kagawa")),
    ("hiroyukingkong7","香川",IG.format("hiroyukingkong7")),
    ("miracle.yossy_shikoku","四国",IG.format("miracle.yossy_shikoku")),
    ("tokushima_cafedanshi","徳島",IG.format("tokushima_cafedanshi")),
    ("syo_ta.kagawa","香川",IG.format("syo_ta.kagawa")),
    ("daily_awawa","徳島",IG.format("daily_awawa")),
    ("tokushima_gourmet_","徳島",IG.format("tokushima_gourmet_")),
    ("tokushima.food","徳島",IG.format("tokushima.food")),
    # --- 島根/鳥取 (search) ---
    ("ka_zuuu28","島根・鳥取",IG.format("ka_zuuu28")),
    ("nana.media0330","島根・鳥取",IG.format("nana.media0330")),
    ("mikuri_daisen","鳥取",IG.format("mikuri_daisen")),
    ("ritotto__faraway","鳥取",IG.format("ritotto__faraway")),
    # --- 熊本/鹿児島 (search) ---
    ("kagoshima_instafood","鹿児島",IG.format("kagoshima_instafood")),
    ("yuya.kumamoto_gurume","熊本",IG.format("yuya.kumamoto_gurume")),
    ("kumalikecom","熊本",IG.format("kumalikecom")),
    ("maakii_kumamoto","熊本",IG.format("maakii_kumamoto")),
    ("aism_wr","鹿児島",IG.format("aism_wr")),
    ("kagoshimagourmet","鹿児島",IG.format("kagoshimagourmet")),
    # --- 北海道 (search) ---
    ("namaragurume","北海道",IG.format("namaragurume")),
    ("iitokomikkeeee_food","北海道",IG.format("iitokomikkeeee_food")),
    ("oniyan_grm","北海道",IG.format("oniyan_grm")),
    ("607keih","北海道",IG.format("607keih")),
    ("sapporo_hinna","北海道",IG.format("sapporo_hinna")),
    # --- 富山/石川 (search) ---
    ("mainichi_toyama","富山",IG.format("mainichi_toyama")),
    ("toyama_joho_gourmet","富山",IG.format("toyama_joho_gourmet")),
    ("yukaritabelog","富山",IG.format("yukaritabelog")),
    ("toyama_sd","富山",IG.format("toyama_sd")),
    ("wwwwcafe","富山",IG.format("wwwwcafe")),
    # --- 長野/山梨 (search) ---
    ("naganodemarumaru","長野",IG.format("naganodemarumaru")),
    ("seritafudousan","長野",IG.format("seritafudousan")),
    ("reo_nagano_food","長野",IG.format("reo_nagano_food")),
    ("porta_yamanashi","山梨",IG.format("porta_yamanashi")),
    ("yamanashi_food","山梨",IG.format("yamanashi_food")),
    ("yamanashi_tori3","山梨",IG.format("yamanashi_tori3")),
    ("yamanashi_select","山梨",IG.format("yamanashi_select")),
    ("aka.yamanashi","山梨",IG.format("aka.yamanashi")),
    # --- 大阪 (search) ---
    ("b.osaka","大阪",IG.format("b.osaka")),
    ("ichiharajunichiro","大阪",IG.format("ichiharajunichiro")),
    ("norimaga01","関西",IG.format("norimaga01")),
    # --- 名古屋/愛知 (search) ---
    ("nagoya.gourmet.map","愛知",IG.format("nagoya.gourmet.map")),
    # --- 福岡 (search) ---
    ("fuk_instafooood","福岡",IG.format("fuk_instafooood")),
    ("hirameshi.1214","福岡",IG.format("hirameshi.1214")),
    ("momono._.o","福岡",IG.format("momono._.o")),
    # --- 京都/神戸/兵庫 (search) ---
    ("kyoto_select","京都",IG.format("kyoto_select")),
    ("gcjapan.kyoto","京都",IG.format("gcjapan.kyoto")),
    ("kyounanitabe","兵庫",IG.format("kyounanitabe")),
    ("yumi.polish","関西",IG.format("yumi.polish")),
    ("erikojiaoi","兵庫",IG.format("erikojiaoi")),
    ("kobe_gourmet_life","兵庫",IG.format("kobe_gourmet_life")),
    ("kyoto_style","京都",IG.format("kyoto_style")),
    ("nenemomoo","京都",IG.format("nenemomoo")),
    # --- 埼玉/千葉 (search) ---
    ("chiba_select","千葉",IG.format("chiba_select")),
    ("chiba_grume0316","千葉",IG.format("chiba_grume0316")),
    ("saitamapple","埼玉",IG.format("saitamapple")),
    ("yuma__gourmet","千葉",IG.format("yuma__gourmet")),
    ("chii.gourmet.kiroku","千葉",IG.format("chii.gourmet.kiroku")),
    ("komashi_morituke","埼玉",IG.format("komashi_morituke")),
    ("saitama_guide_miho","埼玉",IG.format("saitama_guide_miho")),
    ("tkg___food29","千葉",IG.format("tkg___food29")),
    ("saitamagourmet1","埼玉",IG.format("saitamagourmet1")),
    # --- 横浜/神奈川 (search) ---
    ("kanagawa_select","神奈川",IG.format("kanagawa_select")),
    ("kanagawa_gourmet1","神奈川",IG.format("kanagawa_gourmet1")),
    ("taku.0908_yokohama","神奈川",IG.format("taku.0908_yokohama")),
    ("kanagawagourmet","神奈川",IG.format("kanagawagourmet")),
    ("gourmet_kanagawa_","神奈川",IG.format("gourmet_kanagawa_")),
    ("hamoni_kanagawa","神奈川",IG.format("hamoni_kanagawa")),
    ("yukari._yokohama","神奈川",IG.format("yukari._yokohama")),
    ("ericafe_215","神奈川",IG.format("ericafe_215")),
    # --- 宮城/仙台 (search + michinoku article) ---
    ("miyagifood7","宮城",IG.format("miyagifood7")),
    ("ohayo_sendai","宮城",IG.format("ohayo_sendai")),
    ("sendai.no.torisan","宮城",IG.format("sendai.no.torisan")),
    ("mikittymama123","東北",IG.format("mikittymama123")),
    ("sennan_tusin","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("toriage.tohoku","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("sendai_tj_sstyle","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("sendai_miyagi_tsumugi","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("tomandaraki","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("vivid_tohoku","東北","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("ri_ku_gurume","宮城","https://michinokukikaku.jp/sendai-miyagi-influencer-list/"),
    ("maritrip_traveler","宮城・山形",IG.format("maritrip_traveler")),
    ("ladyyuriko0301","東北","https://find-model.jp/insta-lab/instagram-influencers-tohoku-area/"),
    # --- 東京 (star-inc 409 + kurofune + find-model + macaroni articles) ---
    ("tokyo_wagyu_report","東京","https://star-inc.co/topics/409/"),
    ("mash_foodstagram","東京","https://star-inc.co/topics/409/"),
    ("yuuuuto38","東京・大阪","https://star-inc.co/topics/409/"),
    ("wolf.0313","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("uryo1113","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("tokyogourmet3","東京","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("yokoyama___daze","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("tokyo_highcosper_gourmet","東京","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("rioch.youtube","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("jukananan727","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("suppy_umasugi","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("itsho_gourme","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("pito_820","全国","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("osaka_gourmet1","大阪","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("sweet_yup_sweet","東京","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("re__tokyo","東京","https://kurofune-marketing.com/sns-lab/instagram/gourmet-influencer-selection/"),
    ("ma_sa_cafe","東京","https://find-model.jp/insta-lab/influencers-gourmet/"),
    ("tamo__tyan","全国","https://find-model.jp/insta-lab/influencers-gourmet/"),
    ("joker_gourmet","全国","https://find-model.jp/insta-lab/influencers-gourmet/"),
    ("maggydaisymore","全国","https://macaro-ni.jp/14595"),
    ("cao_life","全国","https://macaro-ni.jp/14595"),
    ("miku_colors","全国","https://macaro-ni.jp/14595"),
    ("maca_ron5","全国","https://macaro-ni.jp/14595"),
    ("masayo_san","全国","https://macaro-ni.jp/14595"),
    # --- 静岡 (search) ---
    ("taberu_shizuoka","静岡",IG.format("taberu_shizuoka")),
    ("maichan0727","静岡",IG.format("maichan0727")),
    ("shizuoka_trip","静岡",IG.format("shizuoka_trip")),
    ("shizuoka_select","静岡",IG.format("shizuoka_select")),
    # --- 広島 (bm-peekaboo article) ---
    ("kuishinbou_chan_k","広島","https://www.bm-peekaboo.com/information/8-78/"),
    ("ririm.go","広島","https://www.bm-peekaboo.com/information/8-78/"),
    ("mai.tug","広島","https://www.bm-peekaboo.com/information/8-78/"),
    ("hiro3_ch","広島","https://www.bm-peekaboo.com/information/8-78/"),
    ("mana07nama","広島","https://www.bm-peekaboo.com/information/8-78/"),
    ("mori.629","広島","https://www.bm-peekaboo.com/information/8-78/"),
    # --- 関西 (star-inc 411 article) ---
    ("migram370919","大阪","https://star-inc.co/topics/411/"),
    ("rainbow707nara","奈良・大阪・京都","https://star-inc.co/topics/411/"),
    ("yukaoo0oo","関西","https://star-inc.co/topics/411/"),
    # --- 岡山 (search) ---
    ("marugoto_okayama","岡山",IG.format("marugoto_okayama")),
    ("risa_foodgram","岡山",IG.format("risa_foodgram")),
    ("okayama.gourmet_yama","岡山",IG.format("okayama.gourmet_yama")),
    ("okayamagourmet.keyturn","岡山",IG.format("okayamagourmet.keyturn")),
    ("okayama_gourmet","岡山",IG.format("okayama_gourmet")),
    ("okayamafood77","岡山",IG.format("okayamafood77")),
    ("megurirure","岡山",IG.format("megurirure")),
    ("kurashiki_gurume_tokumori","岡山",IG.format("kurashiki_gurume_tokumori")),
    ("chinami_okayama_trip","岡山",IG.format("chinami_okayama_trip")),
    # --- 群馬 (search) ---
    ("moca_mogumogu","群馬",IG.format("moca_mogumogu")),
    ("taberu_gunma","群馬",IG.format("taberu_gunma")),
    ("gunmanoarukikata1120","群馬",IG.format("gunmanoarukikata1120")),
    ("gunmacon","群馬",IG.format("gunmacon")),
    ("ta_ma_gourmet","群馬",IG.format("ta_ma_gourmet")),
    ("gunma_guruneko","群馬",IG.format("gunma_guruneko")),
    ("gunma_mogumogu","群馬",IG.format("gunma_mogumogu")),
    ("miyasan_gunma_383","群馬",IG.format("miyasan_gunma_383")),
    ("grm_0211cafeee","群馬",IG.format("grm_0211cafeee")),
    ("oishiigunma","群馬",IG.format("oishiigunma")),
    # --- 茨城 (search) ---
    ("ibaraki_gourmet_walker","茨城",IG.format("ibaraki_gourmet_walker")),
    ("ibaraki_yossy","茨城",IG.format("ibaraki_yossy")),
    # --- 奈良 (search) ---
    ("parple_henshubu","奈良",IG.format("parple_henshubu")),
    ("raaichinakata","奈良",IG.format("raaichinakata")),
    ("nara.gurume","奈良",IG.format("nara.gurume")),
    ("naragourmetrpg","奈良",IG.format("naragourmetrpg")),
    ("nara.odekake","奈良",IG.format("nara.odekake")),
    ("nara_lunch_cafe","奈良",IG.format("nara_lunch_cafe")),
    ("nara__style","奈良",IG.format("nara__style")),
    ("kansaigourmetnavi","関西",IG.format("kansaigourmetnavi")),
    # --- 三重 (search) ---
    ("yoko_mie_gourmet","三重",IG.format("yoko_mie_gourmet")),
    # --- 滋賀 (search) ---
    ("shiga_select","滋賀",IG.format("shiga_select")),
    # --- 栃木 (search) ---
    ("tomodi_gourmet","栃木",IG.format("tomodi_gourmet")),
    ("tochigi_gourmet1","栃木",IG.format("tochigi_gourmet1")),
    ("tochigi__gurume","栃木",IG.format("tochigi__gurume")),
    # --- 和歌山 (search + wakayama-kanko article) ---
    ("wakayama.style","和歌山",IG.format("wakayama.style")),
    ("wakayama_select","和歌山",IG.format("wakayama_select")),
    ("wakayama.food","和歌山",IG.format("wakayama.food")),
    ("goto.wakayama","和歌山",IG.format("goto.wakayama")),
    ("aya_akaaa","和歌山",IG.format("aya_akaaa")),
    ("kumichanmos","和歌山",IG.format("kumichanmos")),
    ("sayu517","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("yukachintaxi","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("chobit_couple","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("mikitpg","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("piyorin_trip","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("satomin_japan","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    ("yukari_family_trip","和歌山","https://www.wakayama-kanko.or.jp/features/Instagramer-delicious-wakayama8"),
    # --- 岐阜 (search) ---
    ("tiroteki","岐阜",IG.format("tiroteki")),
    ("akikokobell","岐阜",IG.format("akikokobell")),
    ("hidek125","岐阜",IG.format("hidek125")),
    ("nico_gourmet_","岐阜",IG.format("nico_gourmet_")),
    ("gourmetemperorofficial","愛知・岐阜",IG.format("gourmetemperorofficial")),
    ("gifu_gurume_matome","岐阜",IG.format("gifu_gurume_matome")),
    ("aun_gifu","岐阜",IG.format("aun_gifu")),
    # --- 沖縄 (search) ---
    ("okinawa__select","沖縄",IG.format("okinawa__select")),
    ("okinawa_tabearuki","沖縄",IG.format("okinawa_tabearuki")),
    ("okinawaablog","沖縄",IG.format("okinawaablog")),
    ("okinawa_cafe_gt_","沖縄",IG.format("okinawa_cafe_gt_")),
    ("okinawagurumeakaunto","沖縄",IG.format("okinawagurumeakaunto")),
    # --- 高知 (search) ---
    ("t_umaii","高知",IG.format("t_umaii")),
    # --- 長崎/佐賀 (search) ---
    ("saga_select","佐賀",IG.format("saga_select")),
    ("nagasaki_tabi","長崎",IG.format("nagasaki_tabi")),
    ("nagasaki_gurume","長崎",IG.format("nagasaki_gurume")),
    ("go_nagasaki","長崎・佐賀",IG.format("go_nagasaki")),
    ("mi_nagasaki","長崎",IG.format("mi_nagasaki")),
    ("kyushu.go","九州",IG.format("kyushu.go")),
    ("nagasaki_tokolog","長崎",IG.format("nagasaki_tokolog")),
    ("sagaoishii","佐賀",IG.format("sagaoishii")),
    # --- 宮崎/大分 (search) ---
    ("miyazaki_select","宮崎",IG.format("miyazaki_select")),
    ("meiko_miyazaki_gourmetandlife","宮崎",IG.format("meiko_miyazaki_gourmetandlife")),
    ("oitacity.gourmettrip","大分",IG.format("oitacity.gourmettrip")),
    ("miyazaki_food_diary","宮崎",IG.format("miyazaki_food_diary")),
    ("l_c_p_78","大分",IG.format("l_c_p_78")),
    ("muni_gurume_japan","全国",IG.format("muni_gurume_japan")),
    # --- 全国/東京 系 (影響 media list articles, round 2) ---
    ("hanatomo84","全国","https://influencermarketing-company.com/influencer-column/food-influencer-instagram/"),
    ("kokou_chiba","千葉","https://influencermarketing-company.com/influencer-column/food-influencer-instagram/"),
    ("moguohunter","全国","https://otomo.join-up.co.jp/instagram-gourmet/"),
    ("sweetroad7","全国","https://influencer-company.info/influencer-column/influencer-gourmet/"),
    ("tokyo_morning","東京","https://influencer-company.info/influencer-column/influencer-gourmet/"),
    ("ryuji_foodlabo","全国","https://influencer-company.info/influencer-column/influencer-gourmet/"),
    ("yasemeshi_lab","全国","https://influencer-company.info/influencer-column/influencer-gourmet/"),
    ("angela_satou","全国","https://find-model.jp/insta-lab/instagram-influencers-hokkaido-area/"),
    ("hiromame27","東京","https://star-inc.co/topics/408/"),
    # --- 大阪 (search round 2) ---
    ("samemoon917","大阪",IG.format("samemoon917")),
    ("nekoshi_sato","大阪",IG.format("nekoshi_sato")),
    # --- 愛媛 (search) ---
    ("ehimedinner","愛媛",IG.format("ehimedinner")),
    ("mypl_matsuyama","愛媛",IG.format("mypl_matsuyama")),
    # --- 名古屋/愛知 (umaimono-blog article) ---
    ("onimaga_jp","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("tetsudo_o","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("nagoya.spa","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("subaru.uma","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("gourmetemperor","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("nagoya.m","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    ("umaimonoblog","愛知","https://umaimono-blog.com/aichi-gourmet-blogger/"),
    # --- 東京カフェ系 (insta-antenna article; 店舗・非飲食は除外済み) ---
    ("pumpkin____4","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("negi_0675","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("mitm_tokyo","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("cafemiru.jp","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("ryotatata_9814","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("riekoron8672","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("yayomocha","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("nanakote","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("kumiko_min","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("kmpc51","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("kana_156","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("ozawanayo","東京","https://insta-antenna.com/photo-genic-cafe"),
    ("ayapooh_22","東京","https://insta-antenna.com/photo-genic-cafe"),
    # --- 東京スイーツ (sweetscollection ambassador; 店舗は除外済み) ---
    ("sakuraimasayuki","東京","https://sweetscollection.jp/home/reccomend/8028/"),
]

# 除外(非飲食/純企業/純観光でグルメ発信でないもの): 明示的に落とす
EXCLUDE = set()

base = set(norm(l) for l in open(TXT, encoding="utf-8") if l.strip())

seen = {}
for h, region, src in raw:
    n = norm(h)
    if not n or n in EXCLUDE:
        continue
    if n in seen:
        continue
    seen[n] = {"handle": n, "region": region, "source_url": src}

new = {h: v for h, v in seen.items() if h not in base}

expanded = sorted(new.values(), key=lambda x: x["handle"])
out_path = os.path.join(HERE, "out", "influencer_handles_expanded.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(expanded, f, ensure_ascii=False, indent=2)

# 本番 txt へ追記 (重複なし・1行1handle・@なし小文字・ソート維持)
merged = sorted(base | set(new.keys()))
with open(TXT, "w", encoding="utf-8") as f:
    f.write("\n".join(merged) + "\n")

# 集計
from collections import Counter
regions = Counter(v["region"] for v in new.values())
print(f"collected distinct (this loop): {len(seen)}")
print(f"already in base (dup):          {len(seen)-len(new)}")
print(f"NET NEW:                        {len(new)}")
print(f"base 413 -> new txt total:      {len(merged)}")
print(f"region buckets: {len(regions)}")
for r, c in regions.most_common():
    print(f"  {r}: {c}")
