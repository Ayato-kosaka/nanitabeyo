// app-expo/app/[locale]/contribution-tasks/dish-category-image-review.tsx
//
// #516 【フロント】DishCategories 画像差分レビュー用ツールページ
// 運営用ツール - ユーザー向けアプリからの導線は不要
// 変更前/変更後の画像を比較し、「変更後に差し替えるべきか」を目視でレビューするツール

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, Text, TextInput, TouchableOpacity, Keyboard } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Circle, CheckCircle2, ArrowRight } from "lucide-react-native";

import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
// #1783 SSG(静的書き出し)では window が無く useWindowDimensions() が 0 を返し、
// 負の px が HTML へ焼き付いてハイドレーション後も直らない（hooks/useContentWidth.ts 参照）
import { useContentWidth, useWindowHeight } from "@/hooks/useContentWidth";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";
import { wikimediaThumbFromOriginal } from "@/lib/wikimedia";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

/** #516 【設計】変更前/変更後のカテゴリ情報の型 */
type DishCategoryItem = Pick<SupabaseDishCategories, "id" | "image_url"> & {
	name: string;
};

/** #516 【設計】選択状態の型 */
type Choice = "before" | "after" | null;

/** #516 【設計】カテゴリごとの選択状態 */
type CategorySelection = {
	choice: Choice;
	reason: string; // choice === "before" のときのみ必須
};

/* -------------------------------------------------------------------------- */
/*                               ハードコードデータ                              */
/* -------------------------------------------------------------------------- */

// #516 【設計】変更前のカテゴリデータ（ハードコード）
const BEFORE_DISH_CATEGORIES: DishCategoryItem[] = [
	{
		id: "Q100290176",
		name: "果物料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/5a/Thalassery_Falooda.jpg",
	},
	{
		id: "Q1018095",
		name: "オキナワモズク",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Japanese_Mozuku.jpg",
	},
	{
		id: "Q1047978",
		name: "チャホフビリ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/f/fa/%D0%A7%D0%B0%D1%85%D0%BE%D1%85%D0%B1%D0%B8%D0%BB%D0%B8_2.JPG",
	},
	{
		id: "Q1051482",
		name: "どら焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/9c/Dorayaki_001_%283%29.jpg",
	},
	{
		id: "Q1052236",
		name: "パスタサラダ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e1/Pasta_salad_closeup.JPG",
	},
	{
		id: "Q1057649",
		name: "タンドリーチキン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e1/Chickentandoori.jpg",
	},
	{
		id: "Q1061532",
		name: "チャンプルー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/cc/Goya_Champuru_at_Yumenoya.jpg",
	},
	{
		id: "Q1061842",
		name: "丼物",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/94/Tendon_and_unadon_by_avlxyz.jpg",
	},
	{
		id: "Q1065241",
		name: "揚げ鶏",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/91/Kfc_chicken_potato.jpg",
	},
	{
		id: "Q1067842",
		name: "大福",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Daifuku_1.jpg",
	},
	{
		id: "Q107014807",
		name: "日本の餃子",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b7/Crestes_japoneses_del_Restaurant_Clover.jpg",
	},
	{
		id: "Q107840688",
		name: "ビーフシチュー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6b/Cookbook-beef-stew.jpg",
	},
	{
		id: "Q1104399",
		name: "から揚げ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e6/Chicken_karaage_003.jpg",
	},
	{
		id: "Q11342511",
		name: "ミミガー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2e/Mimiga_001.jpg",
	},
	{
		id: "Q11347260",
		name: "ラフテー",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/5/56/Rafti%2C_Okinawan_stewed_pork_belly_by_ayustety_in_Tokyo.jpg",
	},
	{
		id: "Q1136876",
		name: "沖縄そば",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/5/5f/%E3%82%BD%E3%83%BC%E3%82%AD%E3%81%9D%E3%81%B0%EF%BC%88%E6%B2%96%E7%B8%84%E3%81%9D%E3%81%B0%E5%B0%82%E9%96%80%E3%82%84%E3%82%93%E3%81%B0%E3%82%8B%E3%83%BB%E6%9C%89%E6%A5%BD%E7%94%BA%E4%BA%A4%E9%80%9A%E4%BC%9A%E9%A4%A8%EF%BC%8920240608-P1043176.jpg",
	},
	{
		id: "Q1137701",
		name: "タコライス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Taco_rice_-_Tokyo_area_-_November_9_2016_-_002.jpg",
	},
	{
		id: "Q1142841",
		name: "豚カツ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/d5/Tonkatsu_of_Kimukatsu.jpg",
	},
	{
		id: "Q1144102",
		name: "焼きそば",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Kuroishi_Yakisoba01.JPG",
	},
	{
		id: "Q11559422",
		name: "海鮮料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b2/Seafood_clams.jpg",
	},
	{
		id: "Q11567629",
		name: "焼き魚",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/c/c2/Grilled_Sardines_5.50%E2%82%AC_Marisqueira_O_Varino_Nazar%C3%A9_%283785526688%29.jpg",
	},
	{
		id: "Q1156889",
		name: "湖南料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Fried_Pork_with_Pepper_20210630.jpg",
	},
	{
		id: "Q11646110",
		name: "野菜炒め",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/54/%E8%82%89%E9%87%8E%E8%8F%9C%E7%82%92%E3%82%81.JPG",
	},
	{
		id: "Q1185709",
		name: "串カツ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/70/Miso_katsu_by_OiMax.jpg",
	},
	{
		id: "Q1199026",
		name: "ジョージア料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/40/Georgia%2C_the_Art_of_the_Feast.jpg",
	},
	{
		id: "Q12200",
		name: "クレープ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/09/Crepes_dsc07085.jpg",
	},
	{
		id: "Q12478",
		name: "マカロン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/43/French_macaroons.jpg",
	},
	{
		id: "Q12491",
		name: "ミルフィーユ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6b/Mille-feuille_20100916.jpg",
	},
	{
		id: "Q1298577",
		name: "麻婆豆腐",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Billyfoodmabodofu3.jpg",
	},
	{
		id: "Q131582",
		name: "ティラミス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Classic_Italian_Tiramisu-3_%2829989504485%29.jpg",
	},
	{
		id: "Q13233",
		name: "アイスクリーム",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/31/Ice_Cream_dessert_02.jpg",
	},
	{
		id: "Q13276",
		name: "ケーキ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/9c/Chokolade-kage.JPG",
	},
	{
		id: "Q13290",
		name: "スムージー",
		image_url: "https://commons.wikimedia.org/wiki/File:Melon,_Banana_%26_Orangejuice_(4759988894).jpg",
	},
	{
		id: "Q13314",
		name: "パフェ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/73/Parfait_samples_by_pinguino_in_Osaka%2C_Japan.jpg",
	},
	{
		id: "Q13317",
		name: "ヨーグルト",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b8/Joghurt.jpg",
	},
	{
		id: "Q13360264",
		name: "パイ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/1/14/Pumpkin_Pie.jpg",
	},
	{
		id: "Q13393",
		name: "おにぎり",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/22/Japanese_rice_balls_%28onigiri%29.jpg",
	},
	{
		id: "Q1365868",
		name: "ポークベリー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/49/Schweinebauch-2.jpg",
	},
	{
		id: "Q1366456",
		name: "パニーノ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/67/Italiano_sandwich_01.jpg",
	},
	{
		id: "Q1452513",
		name: "ピンチョス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/56/Pinchos_bermeo_2.JPG",
	},
	{
		id: "Q1501244",
		name: "野菜スープ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a2/Tom_jued_tahoo.jpg",
	},
	{
		id: "Q152088",
		name: "フライドポテト",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/8/8e/Truffle_oil_french_fries_%2833024792848%29.jpg",
	},
	{
		id: "Q152834",
		name: "フルーツサラダ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/74/Fruktsallad_%28Fruit_salad%29.jpg",
	},
	{
		id: "Q15801159",
		name: "シュクメルリ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/7/74/%E6%A0%BC%E9%B2%81%E5%90%89%E4%BA%9A%E8%92%9C%E9%85%B1%E9%B8%A1%E8%82%89.jpg",
	},
	{
		id: "Q15990748",
		name: "mtsvadi",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/8/81/Mtsvadi.jpg",
	},
	{
		id: "Q164606",
		name: "カレー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
	},
	{
		id: "Q167692",
		name: "もんじゃ焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/93/Monjayaki-2006-06-25.jpg",
	},
	{
		id: "Q16836241",
		name: "grilled chicken",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/78/Ayam_bakar.jpg",
	},
	{
		id: "Q16909052",
		name: "Lobiani",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/50/Lobiani%2C_Restaurant_Aragvi.jpg",
	},
	{
		id: "Q16930486",
		name: "ゴーヤーチャンプルー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/cc/Goya_Champuru_at_Yumenoya.jpg",
	},
	{
		id: "Q17224035",
		name: "豆腐ステーキ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/d/d2/%E8%B1%86%E8%85%90%E3%82%B9%E3%83%86%E3%83%BC%E3%82%AD_%2810725311003%29.jpg",
	},
	{
		id: "Q1735570",
		name: "カタルーニャ料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/00/Arr%C3%B2s_de_Pals_amb_pollastre_i_poma.jpg",
	},
	{
		id: "Q177",
		name: "ピザ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a3/Eq_it-na_pizza-margherita_sep2005_sml.jpg",
	},
	{
		id: "Q178",
		name: "パスタ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/3f/%28Pasta%29_by_David_Adam_Kess_%28pic.2%29.jpg",
	},
	{
		id: "Q179010",
		name: "ケバブ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/5b/Lula_kebab_2.jpg",
	},
	{
		id: "Q181055",
		name: "ホット・ドッグ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/fb/Hotdog_-_Evan_Swigart.jpg",
	},
	{
		id: "Q181195",
		name: "たい焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/35/Taiyaki.jpg",
	},
	{
		id: "Q1858518",
		name: "ロビオ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/8/89/Lobio_with_summer_savory_and_ajika.jpg",
	},
	{
		id: "Q186817",
		name: "ポリッジ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/c9/Porridge.jpg",
	},
	{
		id: "Q190715",
		name: "刺身",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Sushi_1.JPG",
	},
	{
		id: "Q191655",
		name: "タコス",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/7/73/001_Tacos_de_carnitas%2C_carne_asada_y_al_pastor.jpg",
	},
	{
		id: "Q192087",
		name: "インド料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Indian_Spices.jpg",
	},
	{
		id: "Q192783",
		name: "ドーナツ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Doughnut.jpg",
	},
	{
		id: "Q195",
		name: "チョコレート",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/f/fe/Cocoa_Powder_and_Chocolate_on_Marble_Background.jpg",
	},
	{
		id: "Q197973",
		name: "フレンチトースト",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/42/FrenchToast.JPG",
	},
	{
		id: "Q20016",
		name: "フィデウア",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a4/Fideua_-_xurde.jpg",
	},
	{
		id: "Q20129",
		name: "オムレツ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b1/FoodOmelete.jpg",
	},
	{
		id: "Q203176",
		name: "牛丼",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/45/Gyuu-don_001.jpg",
	},
	{
		id: "Q207220",
		name: "マフィン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Muffin_NIH.jpg",
	},
	{
		id: "Q20734",
		name: "ドネルケバブ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/aa/D%C3%B6ner_Kebab%2C_Berlin%2C_2010_%2801%29.jpg",
	},
	{
		id: "Q208105",
		name: "リゾット",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Risotto_Weihnachten_2020_13.jpg",
	},
	{
		id: "Q212121",
		name: "パエリア",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/ed/01_Paella_Valenciana_original.jpg",
	},
	{
		id: "Q213062",
		name: "ステーキ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/eb/Eye_Fillet%2C_Grass-Fed_Beef.jpg",
	},
	{
		id: "Q215348",
		name: "チーズケーキ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/e/ea/Baked_cheesecake_with_raspberries_and_blueberries.jpg",
	},
	{
		id: "Q2165047",
		name: "ハモン・イベリコ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/01/Xam%C3%B3ns.jpg",
	},
	{
		id: "Q2303453",
		name: "スルグニ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/02/Discs-of-sulguni-cheese.jpg",
	},
	{
		id: "Q234646",
		name: "ラーメン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/fc/Soy_ramen.jpg",
	},
	{
		id: "Q2431975",
		name: "焼肉",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b7/Yakiniku_002.jpg",
	},
	{
		id: "Q244611",
		name: "オニオンリング",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/09/Flickr_pancakejess_677476794--Onion_rings.jpg",
	},
	{
		id: "Q25004446",
		name: "ブレックファースト・ブリトー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/77/Bacon_Kale_Breakfast_Burrito_%288429773809%29.jpg",
	},
	{
		id: "Q2622030",
		name: "ハルチョー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a4/Kharcho_meat_soup.jpg",
	},
	{
		id: "Q271555",
		name: "ビリヤニ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/38/Dum_Biryani_Plate.jpg",
	},
	{
		id: "Q272502",
		name: "ベーグル",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/1/1d/Bagel-Plain-Alt.jpg",
	},
	{
		id: "Q279575",
		name: "ハチャプリ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/%D0%92%D0%BA%D1%83%D1%81%D0%BD%D1%8B%D0%B9_%D0%B3%D1%80%D1%83%D0%B7%D0%B8%D0%BD%D1%81%D0%BA%D0%B8%D0%B9_%D1%85%D0%B0%D1%87%D0%B0%D0%BF%D1%83%D1%80%D0%B8.jpg/500px-%D0%92%D0%BA%D1%83%D1%81%D0%BD%D1%8B%D0%B9_%D0%B3%D1%80%D1%83%D0%B7%D0%B8%D0%BD%D1%81%D0%BA%D0%B8%D0%B9_%D1%85%D0%B0%D1%87%D0%B0%D0%BF%D1%83%D1%80%D0%B8.jpg",
	},
	{
		id: "Q281278",
		name: "オリヴィエ・サラダ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6f/2023_Sa%C5%82atka_jarzynowa_%281%29.jpg",
	},
	{
		id: "Q28803",
		name: "サンドイッチ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/24/Bologna_sandwich.jpg",
	},
	{
		id: "Q2920963",
		name: "シチュー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/51/Conejo_estofado.jpeg",
	},
	{
		id: "Q30186",
		name: "チョコレートケーキ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/55/Chocolate_fudge_cake.jpg",
	},
	{
		id: "Q30593259",
		name: "アボカドトースト",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6c/Avocado_toast_with_sesame_seeds.jpg",
	},
	{
		id: "Q312839",
		name: "クレームブリュレ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/1/17/2014_0531_Cr%C3%A8me_br%C3%BBl%C3%A9e_Doi_Mae_Salong_%28cropped%29.jpg",
	},
	{
		id: "Q3238049",
		name: "回鍋肉",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/d8/H%C3%BAi_g%C5%ABo_r%C3%B2u_%283958649396%29.jpg",
	},
	{
		id: "Q328709",
		name: "天ぷら",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2e/Tempura_01.jpg",
	},
	{
		id: "Q375",
		name: "ワッフル",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/de/Gaufre_molle.jpg",
	},
	{
		id: "Q3775525",
		name: "もつ鍋",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/61/Motsunabe.jpg",
	},
	{
		id: "Q380532",
		name: "弁当",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Bento_at_Hanabishi%2C_Koyasan.jpg",
	},
	{
		id: "Q388983",
		name: "炊き込みご飯",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/99/Takenoko_gohan.jpg",
	},
	{
		id: "Q39262547",
		name: "fruit tart",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6e/Fruit_tart.png",
	},
	{
		id: "Q396184",
		name: "プーティン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6c/Poutine.JPG",
	},
	{
		id: "Q41415",
		name: "汁物料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Vegetable_beef_barley_soup.jpg",
	},
	{
		id: "Q41927",
		name: "沖縄料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Okinawan_cuisine_set.jpg",
	},
	{
		id: "Q420646",
		name: "フォー",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/b/b2/M%C3%B3n_%C4%83n_%C4%90%C3%B4ng_H%C3%A0%2C_T%E1%BA%BFt_2022_%28ph%E1%BB%9F_L%C3%BD_Qu%E1%BB%91c_s%C6%B0_%E1%BB%9F_c%C3%B4ng_vi%C3%AAn_C%E1%BB%8D_D%E1%BA%A7u%29_%282%29.jpg",
	},
	{
		id: "Q427226",
		name: "オムライス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/0/0d/Omurice_by_Taimeiken.jpg",
	},
	{
		id: "Q44",
		name: "ビール",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e3/NCI_Visuals_Food_Beer.jpg",
	},
	{
		id: "Q44541",
		name: "ホットケーキ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Cr%C3%AApe_opened_up.jpg",
	},
	{
		id: "Q4506424",
		name: "タバカ",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/4/42/%D0%A6%D1%8B%D0%BF%D0%BB%D0%B5%D0%BD%D0%BE%D0%BA_%D1%82%D0%B0%D0%B1%D0%B0%D0%BA%D0%B0.jpg",
	},
	{
		id: "Q4506872",
		name: "Chakapuli",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b0/Chakapuli.jpg",
	},
	{
		id: "Q4516736",
		name: "チヒルトゥマ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/aa/Chikhirtma.jpg",
	},
	{
		id: "Q46383",
		name: "寿司",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/7/7a/Various_sushi%2C_beautiful_October_night_at_midnight.jpg",
	},
	{
		id: "Q466430",
		name: "ナチョス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/7/79/The_Beanery_Nachos.jpg",
	},
	{
		id: "Q470519",
		name: "餅",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Mochi_002.jpg",
	},
	{
		id: "Q471861",
		name: "うどん",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Udon_by_udono.jpg",
	},
	{
		id: "Q483163",
		name: "焼き鳥",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Cooking_yakitori.jpg",
	},
	{
		id: "Q491517",
		name: "サモサ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/cb/Samosachutney.jpg",
	},
	{
		id: "Q4939235",
		name: "汁付き麺",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/c4/Thai_noodle_soup%2C_Khao_Yai%2C_Thailand.jpg",
	},
	{
		id: "Q4959490",
		name: "朝食用サンドイッチ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/9d/Breakfast_sandwich.jpg",
	},
	{
		id: "Q557968",
		name: "あんみつ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/5c/Anmitsu_in_Isezakicho.jpg",
	},
	{
		id: "Q559408",
		name: "羊羹",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/99/Imo-y%C5%8Dkan_001.jpg",
	},
	{
		id: "Q584324",
		name: "ハモン・セラーノ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Plato_de_jam%C3%B3n_%28Eva%29.jpg",
	},
	{
		id: "Q599548",
		name: "饅頭",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b0/Saka-manju_of_Yamazaki_Baking.jpg",
	},
	{
		id: "Q6441202",
		name: "Kubdari",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/95/Kubdari.jpg",
	},
	{
		id: "Q647500",
		name: "朝鮮料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b2/KOCIS_Korean_meal_table_%284553953910%29.jpg",
	},
	{
		id: "Q648352",
		name: "ビビンバ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/f5/Korean.food-Bibimbap-02.jpg",
	},
	{
		id: "Q655040",
		name: "おでん",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/52/Oden_by_Mori_Chan.jpg",
	},
	{
		id: "Q6663",
		name: "ハンバーガー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/62/NCI_Visuals_Food_Hamburger.jpg",
	},
	{
		id: "Q691365",
		name: "四川料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/c2/Kung-pao-shanghai.jpg",
	},
	{
		id: "Q701075",
		name: "お好み焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/59/Okonomiyaki_001.jpg",
	},
	{
		id: "Q701870",
		name: "日本のカレー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/3b/Beef_curry_rice_003.jpg",
	},
	{
		id: "Q702028",
		name: "カツ丼",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/ad/Katsudon_001.jpg",
	},
	{
		id: "Q715858",
		name: "タピオカティー",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/a2/Bubble_Tea.png",
	},
	{
		id: "Q722595",
		name: "キッシュ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/b/b2/Coronation_Quiche%2C_May_2023_03.jpg",
	},
	{
		id: "Q727605",
		name: "チュロス",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/6/6f/Churros_Madrid.jpg",
	},
	{
		id: "Q730298",
		name: "パッタイ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/f8/Phat_thai_-_Chiang_Mai_-_2017-07-08_%28002%29.jpg",
	},
	{
		id: "Q747302",
		name: "卵焼き",
		image_url:
			"https://upload.wikimedia.org/wikipedia/commons/0/06/%E9%B3%A5%E7%84%BC%E3%81%8D%E5%B1%85%E9%85%92%E5%B1%8B_%2839394233682%29.jpg",
	},
	{
		id: "Q7491078",
		name: "かき氷 (広義)",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/38/Sno_cone.jpg",
	},
	{
		id: "Q753910",
		name: "蕎麦",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/Dried_soba_noodles_by_FotoosVanRobin.jpg",
	},
	{
		id: "Q7820827",
		name: "トニス・プリ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/c/cd/Traditional_georgian_bread_%28tonis_puri%29.jpg",
	},
	{
		id: "Q80973",
		name: "朝食",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/f/f4/Breakfast_in_german_hotel.jpg",
	},
	{
		id: "Q841984",
		name: "タイ料理",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/d9/Khanom_Chin_-_Thai_rice_noodles.JPG",
	},
	{
		id: "Q846376",
		name: "スフレ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/57/4_ingredient_berry_souffle.jpg",
	},
	{
		id: "Q846849",
		name: "火鍋",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/a/aa/Day177lilybday.JPG",
	},
	{
		id: "Q862569",
		name: "すき焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/3/32/Sukiyaki_01.jpg",
	},
	{
		id: "Q863794",
		name: "チリコンカーン",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/5/50/Bowl_of_chili.jpg",
	},
	{
		id: "Q877913",
		name: "団子",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2b/Hanami_Dango.jpg",
	},
	{
		id: "Q9053",
		name: "プディング",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/de/Pudding_With_Raspberries_and_Whipped_Cream.jpg",
	},
	{
		id: "Q905527",
		name: "たこ焼き",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/d8/Takoyaki_by_yomi955.jpg",
	},
	{
		id: "Q9266",
		name: "サラダ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/94/Salad_platter.jpg",
	},
	{
		id: "Q937960",
		name: "卵かけご飯",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/Tamagokake-gohan.JPG",
	},
	{
		id: "Q971820",
		name: "ヒンカリ",
		image_url: "https://upload.wikimedia.org/wikipedia/commons/d/df/Khinkali%2C_Restaurant_Aragvi.jpg",
	},
];

// #516 【設計】変更後のカテゴリデータ（ハードコード）- id・nameは同じだが image_url が異なる
const AFTER_DISH_CATEGORIES: Pick<DishCategoryItem, "id" | "image_url">[] = [
	{
		id: "Q11347260",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q11347260/23f43139-1955-42a3-a7af-5c6ed85485c3.webp",
	},
	{
		id: "Q2622030",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q2622030/7b8a062c-df28-4351-a8b7-1dea35ea78b8.webp",
	},
	{
		id: "Q6441202",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q6441202/3be01d6b-9a2c-4db0-8b12-8ba9dbf8fd48.webp",
	},
	{
		id: "Q1365868",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1365868/893a959a-349b-4045-a2e4-15776cb3ed3a.webp",
	},
	{
		id: "Q7820827",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q7820827/9859c45b-5f2d-4bd5-a552-fd13e22a2fce.webp",
	},
	{
		id: "Q186817",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q186817/af963212-10b2-4735-a3a1-9fb12c291eeb.webp",
	},
	{
		id: "Q17224035",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q17224035/47913522-5338-4d28-bc61-0f7e596de9d8.webp",
	},
	{
		id: "Q1366456",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1366456/5c8aa691-c972-4661-a211-10325f0a5e39.webp",
	},
	{
		id: "Q841984",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q841984/4388c6b5-293d-42de-8977-ba49720c6a75.webp",
	},
	{
		id: "Q100290176",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q100290176/c7acf50c-4d04-4145-995b-3ed3efd79d8b.webp",
	},
	{
		id: "Q39262547",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q39262547/d34ee834-0a7a-46d3-9220-a9a7499b59d9.webp",
	},
	{
		id: "Q7491078",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q7491078/d02dbd3d-7e17-4966-a184-763c0a890ab7.webp",
	},
	{
		id: "Q846849",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q846849/123929c7-9e91-4ce0-8c20-5f879c7ac08f.webp",
	},
	{
		id: "Q747302",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q747302/da79647e-07e9-411d-bd8b-583f665ee9ee.webp",
	},
	{
		id: "Q271555",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q271555/ef7493ee-2e3a-46ea-8d7b-1e0eda4141b4.webp",
	},
	{
		id: "Q420646",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q420646/4aca41f9-d305-4433-a891-b61f98ad8537.webp",
	},
	{
		id: "Q730298",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q730298/225c4981-ad08-4501-ba0b-82145be21008.webp",
	},
	{
		id: "Q727605",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q727605/6fab90b3-cf59-40be-ad8f-5ad9d8dc8cbe.webp",
	},
	{
		id: "Q715858",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q715858/e4dfad5f-5eba-4f74-800e-4458f6c10225.webp",
	},
	{
		id: "Q702028",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q702028/aface6f3-dc86-46da-9324-53f28b1e3bf3.webp",
	},
	{
		id: "Q701870",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q701870/9d6df002-091e-4674-82c5-214fcb838aa4.webp",
	},
	{
		id: "Q396184",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q396184/a5eb1fc4-5c98-4abc-b95b-12290ab79ddc.webp",
	},
	{
		id: "Q491517",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q491517/e6c67046-cc93-47aa-b7b5-7f815c7fab34.webp",
	},
	{
		id: "Q559408",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q559408/7ca125c8-d9b4-41d9-a281-2747db490ceb.webp",
	},
	{
		id: "Q647500",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q647500/de1ca2cb-a816-42b9-ad81-028773ffa8a3.webp",
	},
	{
		id: "Q281278",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q281278/011da038-71e6-4891-acb0-c3809273c9fa.webp",
	},
	{
		id: "Q584324",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q584324/de56e66c-4d86-4655-a708-f965d96e816d.webp",
	},
	{
		id: "Q380532",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q380532/796bdec4-6c21-4ae1-bd91-d86464902f43.webp",
	},
	{
		id: "Q4506872",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q4506872/43583558-4c23-4f3b-94bc-2ddea6bbede8.webp",
	},
	{
		id: "Q44",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q44/d2086548-b5d1-42f6-a07b-c89cbb3dc642.webp",
	},
	{
		id: "Q599548",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q599548/aba686ee-2fb8-4131-8af2-0b98f9e3c200.webp",
	},
	{
		id: "Q41927",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q41927/e797b2db-a969-49b8-ac59-4d2c86554f8f.webp",
	},
	{
		id: "Q4506424",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q4506424/12669abe-1549-41d0-8b99-f5872b50b31c.webp",
	},
	{
		id: "Q648352",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q648352/0c6ecdba-0ac5-4a73-95dd-26150102f3d1.webp",
	},
	{
		id: "Q722595",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q722595/5fdd579d-e219-4f58-844b-8b0a8c7d17db.webp",
	},
	{
		id: "Q3775525",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q3775525/bb3fe9b5-9c75-4231-9fe5-7680969b0532.webp",
	},
	{
		id: "Q388983",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q388983/05720ebf-e5d2-43d1-9416-51788a5f5db1.webp",
	},
	{
		id: "Q375",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q375/7f94b8ca-77e7-4083-9296-e20e5c86a6d2.webp",
	},
	{
		id: "Q192087",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q192087/49dfd694-fd8d-4a03-bef1-654601c64a71.webp",
	},
	{
		id: "Q207220",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q207220/d0281beb-b6eb-42ae-9f65-705e64186048.webp",
	},
	{
		id: "Q208105",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q208105/f317e405-6ff8-44be-bd41-56a97211c036.webp",
	},
	{
		id: "Q2920963",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q2920963/90387e7f-33d9-4da2-9739-eac7019ce257.webp",
	},
	{
		id: "Q4939235",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q4939235/50f8e5d7-bfb4-43a9-8f3b-53bf79125d91.webp",
	},
	{
		id: "Q2165047",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q2165047/bf7f135b-3459-4edf-8373-627e934601bc.webp",
	},
	{
		id: "Q1052236",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1052236/551ae790-02e8-473b-9c4e-53d2c1589120.webp",
	},
	{
		id: "Q152088",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q152088/9c9c5045-872d-4ea4-9c62-1da3dc2a8876.webp",
	},
	{
		id: "Q20734",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q20734/10e7cbb6-e111-45f6-9bec-1f8171d8090b.webp",
	},
	{
		id: "Q195",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q195/3f090c7b-1e90-422f-ab96-cb5eda4ab338.webp",
	},
	{
		id: "Q11342511",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q11342511/0994350e-6039-4ea3-b528-2943260c0c7a.webp",
	},
	{
		id: "Q20016",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q20016/de455fd7-f350-4c6e-a0dc-23faf584cb2e.webp",
	},
	{
		id: "Q191655",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q191655/54222b7b-7ecf-4118-80e6-97ec2ddaba9d.webp",
	},
	{
		id: "Q181055",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q181055/8df0a2fd-a3f0-44c8-81e4-3b3b62b4c53f.webp",
	},
	{
		id: "Q1057649",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1057649/153d8540-7677-4684-80cf-60b35f3065d0.webp",
	},
	{
		id: "Q16836241",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q16836241/5504cb1f-4dcd-46c8-ba86-bb7a73ac9280.webp",
	},
	{
		id: "Q1018095",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1018095/f4b9dee0-5e00-4ef9-bb87-833b61ed3125.webp",
	},
	{
		id: "Q1735570",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1735570/02a22161-3d7f-4ff3-977f-542aa402fc8c.webp",
	},
	{
		id: "Q179010",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q179010/9753496b-ff57-4953-9f5e-7d14b70b7e4e.webp",
	},
	{
		id: "Q167692",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q167692/0356bf55-2783-4578-9342-309e5d9db62d.webp",
	},
	{
		id: "Q1452513",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1452513/398b0d8d-a209-41fc-8290-b8b939cf176d.webp",
	},
	{
		id: "Q244611",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q244611/3c02e2d9-f8b4-4633-85f5-5a9ba6daa2f2.webp",
	},
	{
		id: "Q80973",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q80973/85011578-6bb1-430e-a33b-6984340e579b.webp",
	},
	{
		id: "Q41415",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q41415/15fb64d0-d110-4deb-8ef6-58a5c9b4eb2a.webp",
	},
	{
		id: "Q1298577",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1298577/9fa171bf-bcae-46cc-a4b9-c3a6cc28fe7c.webp",
	},
	{
		id: "Q3238049",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q3238049/978609eb-47ad-4e66-809d-eb2bbb24b0fd.webp",
	},
	{
		id: "Q13360264",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13360264/5b02cf52-eceb-441a-b6f1-d7b221b37c26.webp",
	},
	{
		id: "Q483163",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q483163/22dadd09-d4e6-4e6d-a5bb-5cea3eb1ecb3.webp",
	},
	{
		id: "Q11559422",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q11559422/ee4e9fae-40aa-4132-9eb9-cb38af17ff0e.webp",
	},
	{
		id: "Q15990748",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q15990748/165d85dc-f20d-48bf-acf0-b8916d0b2f42.webp",
	},
	{
		id: "Q4516736",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q4516736/ed1e987f-e208-49c5-a8be-442ca7baf380.webp",
	},
	{
		id: "Q2303453",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q2303453/6907daac-7113-4de8-b8f7-cb308f1b50e7.webp",
	},
	{
		id: "Q11646110",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q11646110/38438c27-c9c2-438b-8112-fa054aa86e58.webp",
	},
	{
		id: "Q152834",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q152834/f05b6914-bcda-4e15-ae1a-0fb2993aea36.webp",
	},
	{
		id: "Q9053",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q9053/f1131596-2b27-49c9-8c30-9241fc459bfd.webp",
	},
	{
		id: "Q877913",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q877913/2a92ffea-aa12-45b5-ab17-584a29517928.webp",
	},
	{
		id: "Q1047978",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1047978/65ec4196-d1e8-4a9b-8e36-f661db0c4836.webp",
	},
	{
		id: "Q1156889",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1156889/c0051a58-b1cb-4de1-bd16-8448f9915be7.webp",
	},
	{
		id: "Q16909052",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q16909052/28eac4d5-8639-4ee7-8c15-7f6fa550fab1.webp",
	},
	{
		id: "Q15801159",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q15801159/11e1cd97-646a-4e4a-866a-1199f3d74ac6.webp",
	},
	{
		id: "Q1199026",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1199026/a4c780db-af00-4fc5-913a-c591aa6d7036.webp",
	},
	{
		id: "Q1136876",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1136876/27cb23e2-361f-4fac-a0d4-95dce89843c6.webp",
	},
	{
		id: "Q691365",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q691365/8a13993d-c4dc-4869-935b-baea8781f46f.webp",
	},
	{
		id: "Q1501244",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1501244/b86b7b01-4681-4f9c-9099-69e67f86e3f9.webp",
	},
	{
		id: "Q466430",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q466430/9120382c-30a6-43d1-846e-8e1eb7c142a4.webp",
	},
	{
		id: "Q1061532",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1061532/cb1bccad-af43-4ef2-9e5b-dfab0ea986e1.webp",
	},
	{
		id: "Q212121",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q212121/f629886f-ae1a-46d8-ac16-6810725a67ce.webp",
	},
	{
		id: "Q30593259",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q30593259/22264747-8c78-4c7b-b11d-756dc2e41039.webp",
	},
	{
		id: "Q846376",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q846376/00a2979b-ecb3-4716-b2de-7630a88e7f04.webp",
	},
	{
		id: "Q863794",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q863794/11291f5f-5f8f-4d28-b851-9a0974198776.webp",
	},
	{
		id: "Q312839",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q312839/7f7e445f-7bba-4a77-ba11-8ca4af479841.webp",
	},
	{
		id: "Q107014807",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q107014807/1d820bb4-ebf6-4d3e-9a8d-368d52fe6091.webp",
	},
	{
		id: "Q272502",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q272502/ccf149ee-6479-4bcb-ad60-cbe18ff30162.webp",
	},
	{
		id: "Q13233",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13233/ddb0d7c2-cf04-48b9-8359-7919c50fcdcd.webp",
	},
	{
		id: "Q1067842",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1067842/b7fcbc1f-25df-4fd1-ae0d-ce8a24079474.webp",
	},
	{
		id: "Q107840688",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q107840688/140a2521-4a8f-4bc4-8a58-cd360832ec15.webp",
	},
	{
		id: "Q30186",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q30186/840b1337-2644-41ec-a034-24471635edcb.webp",
	},
	{
		id: "Q12491",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q12491/e20fe931-cac3-4f89-9044-1290ea0e9ff3.webp",
	},
	{
		id: "Q25004446",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q25004446/21d43c02-8316-48cf-a89d-a5f7f521d980.webp",
	},
	{
		id: "Q1142841",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1142841/0cde0ad9-8237-40f6-bcd9-1880161d9f84.webp",
	},
	{
		id: "Q2431975",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q2431975/0daf7de7-ff39-4c48-b82d-77586865f5b7.webp",
	},
	{
		id: "Q131582",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q131582/4d2cafd8-5ca1-4b2a-ac7f-f8cfa340eeca.webp",
	},
	{
		id: "Q177",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q177/51eea459-598c-439b-9efb-48be8ea0b90a.webp",
	},
	{
		id: "Q215348",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q215348/25a045ee-021b-4a28-804a-314a0ebf76a1.webp",
	},
	{
		id: "Q328709",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q328709/0105b046-bd0d-4bb5-8210-8ab482ae9f09.webp",
	},
	{
		id: "Q279575",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q279575/216fa12a-2ca6-4c68-bf6b-b2c0e6989206.webp",
	},
	{
		id: "Q213062",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q213062/a8e41705-3ef5-4780-80b0-45bf0a9f16c2.webp",
	},
	{
		id: "Q192783",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q192783/a6cb778f-03f9-42e8-82dd-dd945449a715.webp",
	},
	{
		id: "Q937960",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q937960/cc0a5d04-1911-41e6-b342-7888152cca25.webp",
	},
	{
		id: "Q1858518",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1858518/305a8b8d-10b4-4aa9-baca-5be9c4cb2253.webp",
	},
	{
		id: "Q1061842",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1061842/11bd26ba-a31a-4b2d-bcd3-06f0af4a9e7a.webp",
	},
	{
		id: "Q557968",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q557968/3b7f0b81-c670-4649-aece-266f2a98afc6.webp",
	},
	{
		id: "Q46383",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q46383/08c1958c-a395-4da6-bd0d-35ff4e4a79ee.webp",
	},
	{
		id: "Q862569",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q862569/026a3d32-e8f8-49e5-ac92-db1c86f9b8ea.webp",
	},
	{
		id: "Q6663",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q6663/667047c9-f8cc-4e02-a8aa-7f94f140010e.webp",
	},
	{
		id: "Q4959490",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q4959490/9f849b13-9c74-435d-a34f-6878c651693c.webp",
	},
	{
		id: "Q655040",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q655040/8856e7cc-58e7-4efc-874d-24305b2ba67f.webp",
	},
	{
		id: "Q197973",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q197973/c7ff19af-07fc-44ba-963f-f001bfdae49d.webp",
	},
	{
		id: "Q203176",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q203176/5d2a2548-b866-42cb-bb46-efe348b29c46.webp",
	},
	{
		id: "Q12478",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q12478/b62c0f33-1d05-4843-92c6-3009ed0e6dca.webp",
	},
	{
		id: "Q1051482",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1051482/10ac9525-9cff-4bab-8a58-4fe99848f2ae.webp",
	},
	{
		id: "Q16930486",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q16930486/d120d550-ad45-47c2-a277-5875c70414e7.webp",
	},
	{
		id: "Q427226",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q427226/c7733e2f-8488-46ab-a87a-eb07d4217ac4.webp",
	},
	{
		id: "Q13314",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13314/968ad112-c54b-45e1-bc2c-2e7f340e11d8.webp",
	},
	{
		id: "Q20129",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q20129/06514a24-9fb6-43e0-b859-dbde6de3f11c.webp",
	},
	{
		id: "Q13276",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13276/e245e071-3da3-4232-9f6b-e55f3a04beb5.webp",
	},
	{
		id: "Q13317",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13317/cea981f8-3360-4375-bafb-6a5464794e23.webp",
	},
	{
		id: "Q178",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q178/1f863d20-c13a-486a-969f-eaf814fc2482.webp",
	},
	{
		id: "Q1137701",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1137701/17812d3c-a655-49c9-b966-6d65819d188a.webp",
	},
	{
		id: "Q971820",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q971820/57cd27e4-13e6-491f-badf-8be6c10cfb73.webp",
	},
	{
		id: "Q470519",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q470519/ab273a11-ae57-4461-ae2b-a47a984bbe8f.webp",
	},
	{
		id: "Q12200",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q12200/52006fd4-e0cc-4e4d-baaf-a6ae15f1d9f3.webp",
	},
	{
		id: "Q13393",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13393/1dbcc37f-b1a0-4755-8699-eda0056b2e3a.webp",
	},
	{
		id: "Q9266",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q9266/019de032-cfcb-47a1-b0f9-187969c2ab6b.webp",
	},
	{
		id: "Q13290",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q13290/6f453e38-1ff9-4914-acde-112d5754521e.webp",
	},
	{
		id: "Q1065241",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1065241/5016c255-c504-4b85-9281-b1e80dd5d93d.webp",
	},
	{
		id: "Q11567629",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q11567629/232e46d8-f3dd-4eca-ab24-49e32933b67e.webp",
	},
	{
		id: "Q181195",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q181195/357f2d72-6751-4708-92a9-a797046a20b3.webp",
	},
	{
		id: "Q1104399",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1104399/341de730-d5aa-4384-9785-9fda8ccbcda6.webp",
	},
	{
		id: "Q44541",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q44541/2151aaea-d91a-4a39-9510-1bed06b8a8f1.webp",
	},
	{
		id: "Q28803",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q28803/1e3bc384-1d46-4cef-bd31-7f1257faaf7f.webp",
	},
	{
		id: "Q190715",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q190715/2affabec-07c1-43e9-a2f1-aa6ab8cce3d1.webp",
	},
	{
		id: "Q1185709",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1185709/0983de93-4d35-40bf-a375-df960b8afc14.webp",
	},
	{
		id: "Q164606",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q164606/0dd457fc-f9d4-4d5b-bd7c-a114f1f0907e.webp",
	},
	{
		id: "Q1144102",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q1144102/036ea5f6-2002-4408-9bec-4dd4c46a7cc7.webp",
	},
	{
		id: "Q905527",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q905527/16e82193-1434-4fcc-b919-bafa4c8defe3.webp",
	},
	{
		id: "Q753910",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q753910/05d29c46-3518-4039-8a17-807e1076b6f0.webp",
	},
	{
		id: "Q471861",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q471861/052a36d2-b278-477d-a86f-f98f1c2ec555.webp",
	},
	{
		id: "Q234646",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q234646/015d2391-4df1-4e83-ab1c-4ac1b03e0fae.webp",
	},
	{
		id: "Q701075",
		image_url:
			"https://cdn-public.nanitabeyo.net/dish_categories/image_url/Q701075/06567275-566b-4d44-9aea-c9db2021ae89.webp",
	},
];

// #516 【設計】理由候補のラジオボタン用文字列
const REASON_OPTIONS = ["変更後の料理が違う料理になっている", "変更後の画像のクオリティが下がっている"] as const;

// #516 【パフォーマンス】変更後カテゴリのIDによるルックアップ用Map
const AFTER_CATEGORY_MAP = new Map<string, Pick<DishCategoryItem, "id" | "image_url">>(
	AFTER_DISH_CATEGORIES.map((item) => [item.id, item]),
);

/* -------------------------------------------------------------------------- */
/*                                  メインページ                               */
/* -------------------------------------------------------------------------- */

export default function DishCategoryImageReviewPage() {
	const insets = useSafeAreaInsets();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const screenWidth = useContentWidth();
	const screenHeight = useWindowHeight();
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// #516 【設計】説明文表示フラグ
	const [showDescription, setShowDescription] = useState(false);

	// #516 【設計】ローカルstate: 選択マップ (categoryId -> { choice, reason })
	const [selectionMap, setSelectionMap] = useState<Record<string, CategorySelection>>({});

	// #516 【設計】モーダル用: 現在選択中のカテゴリ
	const [activeCategory, setActiveCategory] = useState<DishCategoryItem | null>(null);

	// #516 【設計】モーダル内一時state: 理由テキスト
	const [modalReason, setModalReason] = useState("");

	// #516 【設計】モーダル内一時state: 選択中の理由候補インデックス
	const [selectedReasonIndex, setSelectedReasonIndex] = useState<number | null>(null);

	// #516 【設計】差分画像を非表示にするフラグ（モーダル内共通）
	const [hideDiffImages, setHideDiffImages] = useState(false);

	const {
		LegacyBlurModal,
		open: openModal,
		close: closeModal,
	} = useLegacyBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	// #516 【設計】レイアウト計算
	const PADDING_HORIZONTAL = 16;
	const GAP = 12;
	const cardWidth = screenWidth - PADDING_HORIZONTAL * 2;
	const imageWidth = (cardWidth - GAP * 3 - 80) / 2;
	const imageHeight = (imageWidth / 9) * 16;

	// #516 【設計】モーダル内の画像サイズ
	const modalImageWidth = screenWidth - 32 - 32; // padding
	const modalImageHeight = (modalImageWidth / 9) * 16;

	/* ------------------------------------------------------------------ */
	/*                           初期化処理                                 */
	/* ------------------------------------------------------------------ */

	useEffect(() => {
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, []);

	/* ------------------------------------------------------------------ */
	/*                           計算プロパティ                             */
	/* ------------------------------------------------------------------ */

	const selectedCount = useMemo(() => {
		return Object.values(selectionMap).filter((s) => s.choice !== null).length;
	}, [selectionMap]);

	const totalCount = BEFORE_DISH_CATEGORIES.length;

	// #516 【設計】送信ボタン活性条件: 全カテゴリでchoice決定 & beforeの場合はreason必須
	const canSubmit = useMemo(() => {
		return BEFORE_DISH_CATEGORIES.every((item) => {
			const sel = selectionMap[item.id];
			if (!sel || sel.choice === null) return false;
			if (sel.choice === "before" && sel.reason.trim().length === 0) return false;
			return true;
		});
	}, [selectionMap]);

	/* ------------------------------------------------------------------ */
	/*                           イベントハンドラ                          */
	/* ------------------------------------------------------------------ */

	/** #516 【設計】変更後カードタップ → 即座に「変更後」を選択状態にする */
	const handleAfterSelect = useCallback(
		(categoryId: string) => {
			lightImpact();
			setSelectionMap((prev) => ({
				...prev,
				[categoryId]: { choice: "after", reason: "" },
			}));
		},
		[lightImpact],
	);

	/** #516 【設計】変更前カードタップ → 理由入力モーダルを開く */
	const handleBeforeSelect = useCallback(
		(category: DishCategoryItem) => {
			lightImpact();
			setActiveCategory(category);
			// 既存の選択状態があればそれを復元
			const existingSel = selectionMap[category.id];
			if (existingSel && existingSel.choice === "before") {
				setModalReason(existingSel.reason);
				// 理由候補に一致するものがあればインデックスをセット
				const idx = REASON_OPTIONS.findIndex((opt) => opt === existingSel.reason);
				setSelectedReasonIndex(idx >= 0 ? idx : null);
			} else {
				setModalReason("");
				setSelectedReasonIndex(null);
			}
			openModal();
		},
		[lightImpact, openModal, selectionMap],
	);

	/** #516 【設計】理由候補をタップ → テキストエリアに反映 */
	const handleReasonOptionSelect = useCallback(
		(index: number) => {
			lightImpact();
			setSelectedReasonIndex(index);
			setModalReason(REASON_OPTIONS[index]);
		},
		[lightImpact],
	);

	/** #516 【設計】モーダルのキャンセルボタン */
	const handleModalCancel = useCallback(() => {
		Keyboard.dismiss();
		closeModal();
		setActiveCategory(null);
		setModalReason("");
		setSelectedReasonIndex(null);
	}, [closeModal]);

	/** #516 【設計】モーダルの保存ボタン */
	const handleModalSave = useCallback(() => {
		if (!activeCategory) return;
		if (modalReason.trim().length === 0) return;

		lightImpact();
		setSelectionMap((prev) => ({
			...prev,
			[activeCategory.id]: {
				choice: "before",
				reason: modalReason.trim(),
			},
		}));
		Keyboard.dismiss();
		closeModal();
		setActiveCategory(null);
		setModalReason("");
		setSelectedReasonIndex(null);
	}, [activeCategory, modalReason, lightImpact, closeModal]);

	/** #516 【設計】リセットボタン */
	const handleReset = useCallback(() => {
		lightImpact();
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, [lightImpact]);

	/** #516 【設計】送信処理 */
	const handleSubmit = useCallback(() => {
		if (!canSubmit) return;

		lightImpact();

		const payload = BEFORE_DISH_CATEGORIES.map((beforeItem) => {
			const afterItem = AFTER_CATEGORY_MAP.get(beforeItem.id);
			const sel = selectionMap[beforeItem.id];

			return {
				beforeId: beforeItem.id,
				beforeImageUrl: beforeItem.image_url,
				name: beforeItem.name,
				afterImageUrl: afterItem?.image_url ?? null,
				choice: sel?.choice ?? null,
				reason: sel?.choice === "before" ? sel.reason.trim() : "",
			};
		});

		logFrontendEvent({
			event_name: "tools_dish_category_image_review_submitted",
			error_level: "log",
			payload: { submission: payload },
		});

		showSnackbar("送信しました");

		// 送信後リセット
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, [canSubmit, lightImpact, logFrontendEvent, showSnackbar, selectionMap]);

	/* ------------------------------------------------------------------ */
	/*                             レンダリング                            */
	/* ------------------------------------------------------------------ */

	/** #516 【設計】カテゴリカードのレンダリング */
	const renderCategoryCard = useCallback(
		(beforeItem: DishCategoryItem) => {
			const afterItem = AFTER_CATEGORY_MAP.get(beforeItem.id);
			const sel = selectionMap[beforeItem.id];
			const isBeforeSelected = sel?.choice === "before";
			const isAfterSelected = sel?.choice === "after";

			return (
				<View key={beforeItem.id} style={styles.categoryCard}>
					{/* カテゴリ名 */}
					<Text style={styles.categoryName}>{beforeItem.name}</Text>

					{/* 2列: 変更前 / 変更後 */}
					<View style={styles.imageRow}>
						{/* 変更前 */}
						<Pressable
							style={[styles.imageCard, { width: imageWidth }, isBeforeSelected && styles.imageCardSelected]}
							onPress={() => handleBeforeSelect(beforeItem)}
							android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
							<View style={[styles.imageContainer, { height: imageHeight }]}>
								<Image
									source={{ uri: wikimediaThumbFromOriginal(beforeItem.image_url, 640) }}
									style={StyleSheet.absoluteFill}
									contentFit="cover"
									transition={100}
								/>
								{isBeforeSelected && (
									<View style={styles.checkBadge}>
										{/* 緑（successFill）で塗り潰したバッジの上の白。地の色が振れないので文字も振らない */}
										<Check size={16} color={FixedColors.onFilled} />
									</View>
								)}
							</View>
						</Pressable>

						{/* 画像間の矢印 */}
						<View style={styles.arrowContainer}>
							<ArrowRight size={20} color={colors.textSecondary} />
						</View>

						{/* 変更後 */}
						<Pressable
							style={[styles.imageCard, { width: imageWidth }, isAfterSelected && styles.imageCardSelected]}
							onPress={() => handleAfterSelect(beforeItem.id)}
							android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
							<View style={[styles.imageContainer, { height: imageHeight }]}>
								<Image
									source={{ uri: afterItem?.image_url }}
									style={StyleSheet.absoluteFill}
									contentFit="cover"
									transition={100}
								/>
								{isAfterSelected && (
									<View style={styles.checkBadge}>
										{/* 緑（successFill）で塗り潰したバッジの上の白。地の色が振れないので文字も振らない */}
										<Check size={16} color={FixedColors.onFilled} />
									</View>
								)}
							</View>
						</Pressable>
					</View>
				</View>
			);
		},
		[selectionMap, imageWidth, imageHeight, handleBeforeSelect, handleAfterSelect, styles, colors],
	);

	// #516 【設計】モーダル内の変更前/変更後画像を取得
	const activeBefore = activeCategory;
	const activeAfter = activeCategory ? AFTER_CATEGORY_MAP.get(activeCategory.id) : null;

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>料理カテゴリ画像レビュー</Text>
				<Text style={styles.headerSubtitle}>変更前と変更後の画像を比較し、どちらを採用するか選択してください</Text>
			</View>

			{/* 使い方説明 */}
			<View style={styles.descriptionSection}>
				<TouchableOpacity onPress={() => setShowDescription(!showDescription)} style={styles.descriptionToggle}>
					<Text style={styles.descriptionToggleText}>
						{showDescription ? "この画面の使い方を閉じる" : "この画面の使い方を開く"}
					</Text>
					<Text style={styles.descriptionToggleIcon}>{showDescription ? "▲" : "▼"}</Text>
				</TouchableOpacity>

				{showDescription && (
					<Text style={styles.descriptionText}>
						料理カテゴリごとに、変更前と変更後の画像を見比べて
						{"\n"}
						どちらの画像を採用するかを選択するための管理ツールです。
						{"\n\n"}
						1. 各カードの「変更前」または「変更後」の画像をタップします。
						{"\n"}
						2. 変更後をタップすると、そのまま「変更後の画像を採用」として選択されます。
						{"\n"}
						3. 変更前をタップすると、「変更前を採用する理由」を入力するモーダルが表示されます。
						{"\n"}
						4. すべてのカテゴリについて選択が完了したら、画面下部の「送信」ボタンを押してください。
						{"\n\n"}※ 変更前を選ぶ場合は、必ず理由を入力してください。
						{"\n"}※ 「リセット」ボタンで、すべての選択を初期状態に戻すことができます。
					</Text>
				)}
			</View>

			{/* カテゴリ一覧 */}
			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={[styles.scrollViewContent, { paddingBottom: 140 }]}
				showsVerticalScrollIndicator={false}>
				{BEFORE_DISH_CATEGORIES.map(renderCategoryCard)}
			</ScrollView>

			{/* フッター */}
			<View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
				<Text style={styles.footerStatus}>
					選択済み: {selectedCount}/{totalCount}件
				</Text>
				<View style={styles.footerButtons}>
					<PrimaryButton
						label="リセット"
						onPress={handleReset}
						colors={colors.buttonNeutralGradient}
						style={styles.resetButton}
					/>
					<PrimaryButton
						label={`送信（${selectedCount}/${totalCount}）`}
						onPress={handleSubmit}
						disabled={!canSubmit}
						colors={canSubmit ? colors.buttonSuccessGradient : colors.buttonDisabledGradient}
						style={styles.submitButton}
					/>
				</View>
			</View>

			{/* 理由入力モーダル */}
			<LegacyBlurModal contentContainerStyle={styles.modalContent}>
				{activeCategory && (
					<ScrollView
						style={{ maxHeight: screenHeight - 150 }}
						showsVerticalScrollIndicator={false}
						keyboardShouldPersistTaps="handled">
						<Text style={styles.modalTitle}>{activeCategory.name}</Text>
						<Text style={styles.modalSubtitle}>「変更前の画像を採用する理由」を入力してください。</Text>

						{/* 差分画像を表示しないチェックボックス */}
						<TouchableOpacity style={styles.checkboxRow} onPress={() => setHideDiffImages(!hideDiffImages)}>
							{hideDiffImages ? (
								<CheckCircle2 size={20} color={colors.successStrong} />
							) : (
								<Circle size={20} color={colors.textSecondary} />
							)}
							<Text style={styles.checkboxLabel}>差分画像を表示しない（次回以降も）</Text>
						</TouchableOpacity>

						{/* 差分画像エリア */}
						{!hideDiffImages && (
							<View style={styles.modalImageSection}>
								<Text style={styles.modalImageLabel}>■ 変更前の画像</Text>
								<View style={[styles.modalImageContainer, { height: modalImageHeight }]}>
									<Image
										source={{
											uri: activeBefore ? wikimediaThumbFromOriginal(activeBefore.image_url, 1280) : undefined,
										}}
										style={StyleSheet.absoluteFill}
										contentFit="cover"
										transition={100}
									/>
								</View>

								<Text style={[styles.modalImageLabel, { marginTop: 12 }]}>■ 変更後の画像</Text>
								<View style={[styles.modalImageContainer, { height: modalImageHeight }]}>
									<Image
										source={{ uri: activeAfter?.image_url }}
										style={StyleSheet.absoluteFill}
										contentFit="cover"
										transition={100}
									/>
								</View>
							</View>
						)}

						{/* 理由入力エリア */}
						<Text style={styles.modalSectionLabel}>■ 理由</Text>
						<TextInput
							style={styles.reasonInput}
							value={modalReason}
							onChangeText={setModalReason}
							placeholder="例: 変更後の料理が違う料理になっている"
							placeholderTextColor={colors.textTertiary}
							multiline
							numberOfLines={3}
							textAlignVertical="top"
						/>

						{/* 理由候補 */}
						<Text style={styles.modalSectionLabel}>（よくある理由）</Text>
						{REASON_OPTIONS.map((option, index) => (
							<TouchableOpacity
								key={index}
								style={styles.reasonOptionRow}
								onPress={() => handleReasonOptionSelect(index)}>
								{selectedReasonIndex === index ? (
									<CheckCircle2 size={18} color={colors.successStrong} />
								) : (
									<Circle size={18} color={colors.textSecondary} />
								)}
								<Text style={styles.reasonOptionText}>{option}</Text>
							</TouchableOpacity>
						))}

						{/* ボタン */}
						<View style={styles.modalButtonRow}>
							<PrimaryButton
								label="キャンセル"
								onPress={handleModalCancel}
								colors={colors.buttonNeutralGradient}
								style={styles.modalButton}
							/>
							<PrimaryButton
								label="保存"
								onPress={handleModalSave}
								disabled={modalReason.trim().length === 0}
								colors={modalReason.trim().length > 0 ? colors.buttonSuccessGradient : colors.buttonDisabledGradient}
								style={styles.modalButton}
							/>
						</View>
					</ScrollView>
				)}
			</LegacyBlurModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.background,
		},
		header: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			backgroundColor: c.surface,
			borderBottomWidth: 1,
			borderBottomColor: c.border,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
		},
		headerSubtitle: {
			fontSize: 12,
			color: c.textSecondary,
			marginTop: 4,
		},
		descriptionSection: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			backgroundColor: c.surface,
			borderBottomWidth: 1,
			borderBottomColor: c.border,
		},
		descriptionToggle: {
			flexDirection: "row",
			alignItems: "center",
			paddingVertical: 6,
		},
		descriptionToggleText: {
			fontSize: 14,
			fontWeight: "600",
			flex: 1,
			color: c.textPrimary,
		},
		descriptionToggleIcon: {
			fontSize: 16,
			color: c.textSecondary,
		},
		descriptionText: {
			fontSize: 12,
			lineHeight: 18,
			color: c.textSecondaryAlt,
			marginTop: 8,
		},
		scrollView: {
			flex: 1,
		},
		scrollViewContent: {
			paddingHorizontal: 16,
			paddingTop: 16,
		},
		categoryCard: {
			backgroundColor: c.surface,
			borderRadius: 12,
			padding: 12,
			marginBottom: 16,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.1,
			shadowRadius: 4,
			elevation: 3,
		},
		categoryName: {
			fontSize: 16,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 12,
		},
		imageRow: {
			flexDirection: "row",
			justifyContent: "space-between",
			gap: 12,
			alignItems: "center",
		},
		arrowContainer: {
			width: 24,
			alignItems: "center",
			justifyContent: "center",
		},
		imageCard: {
			borderRadius: 8,
			overflow: "hidden",
			borderWidth: 2,
			borderColor: c.border,
		},
		imageCardSelected: {
			borderColor: c.successStrong,
			borderWidth: 3,
		},
		imageLabel: {
			// 削除: ラベルは使用しない
			display: "none",
		},
		imageContainer: {
			position: "relative",
		},
		checkBadge: {
			position: "absolute",
			top: 8,
			right: 8,
			width: 24,
			height: 24,
			borderRadius: 12,
			backgroundColor: c.successFill,
			justifyContent: "center",
			alignItems: "center",
		},
		footer: {
			position: "absolute",
			bottom: 0,
			left: 0,
			right: 0,
			padding: 16,
			backgroundColor: c.surface,
			borderTopWidth: 1,
			borderTopColor: c.border,
		},
		footerStatus: {
			fontSize: 14,
			color: c.textSecondaryAlt,
			marginBottom: 12,
			textAlign: "center",
		},
		footerButtons: {
			flexDirection: "row",
			gap: 12,
		},
		resetButton: {
			flex: 1,
		},
		submitButton: {
			flex: 2,
		},
		modalContent: {
			paddingHorizontal: 16,
			paddingTop: 16,
		},
		modalTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 4,
		},
		modalSubtitle: {
			fontSize: 14,
			color: c.textSecondary,
			marginBottom: 16,
		},
		checkboxRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			paddingVertical: 8,
			marginBottom: 12,
		},
		checkboxLabel: {
			fontSize: 14,
			color: c.textSecondaryAlt,
		},
		modalImageSection: {
			marginBottom: 16,
		},
		modalImageLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimary,
			marginBottom: 8,
		},
		modalImageContainer: {
			borderRadius: 8,
			overflow: "hidden",
			backgroundColor: c.surfacePlaceholderAlt,
		},
		modalSectionLabel: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textPrimary,
			marginBottom: 8,
			marginTop: 8,
		},
		reasonInput: {
			borderWidth: 1,
			borderColor: c.borderNeutral,
			borderRadius: 8,
			padding: 12,
			fontSize: 14,
			color: c.textPrimary,
			backgroundColor: c.surface,
			minHeight: 80,
		},
		reasonOptionRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			paddingVertical: 10,
		},
		reasonOptionText: {
			fontSize: 14,
			color: c.textSecondaryAlt,
			flex: 1,
		},
		modalButtonRow: {
			flexDirection: "row",
			gap: 12,
			marginTop: 20,
			marginBottom: 32,
		},
		modalButton: {
			flex: 1,
		},
	});
