/*
このファイルの責務
- SNS の URL から 1 件を取り込む画面。**入口は 2 つ、着地は 1 つ**である。
    1. OS の共有シート（`lib/sharedTextSource.*` → `lib/snsShareIntake.ts` → `?url=`）
    2. my-dishes の ＋ ボタン（`?url=` 無しで開く。ここで貼り付ける）
- 上部タブで「食べたを記録」（＝既存のレビュー投稿導線）へ切り替えられる。

## ログイン不要である（#1375 実機確認）

取り込んだ `dish_media` の投稿者は **アプリのユーザーではない**（SNS 側の投稿者）ので
`user_id` は NULL のままにし、ユーザーとの紐付けは `reactions(save)` が持つ。匿名ユーザーも
実 user id を持ち save は書けるので、ここにフルログインを要求する理由が無い。
API 側も `AuthAnonGuard`（匿名可）にしてある。
**「食べたを記録」だけは公開レビューの投稿なのでログインが要る**（切替時に判定する）。

## ルートである理由（BlurModal ではない）
`Portal.Host` は `<Stack>` を包んでいる（`app/[locale]/_layout.tsx`）ので、オーバーレイを開いたまま
push すると遷移先が下に潜る（#1364 で実測）。加えて共有からの着地は
**「アプリ未起動 → 起動 → ここ」** という経路を持ち、URL だけで再現できる必要がある。
`scripts/assert-legacy-blur-modal-boundary.mjs` が `Portal` の import を禁じており、
`__tests__/snsImportRoute.test.tsx` が「この画面は Portal を 1 つも描かない」を固定している。

## `url` は必ず `resolveSnsShareIntakeView()` を通してから使う
`lib/snsShareIntake.ts` が canonical / expand URL だけをクエリへ載せるが、この画面は
URL 直叩きでも開けるし、貼り付け欄からは任意の文字列が入る。**生の値を画面に出さない。**

## 候補は «出れば嬉しい» もので、**出なくても保存できる**

⚠️ ここが一度壊れていた。`resolve` は **`lat` / `lng` / `radius` が渡されたときだけ**店舗候補を
探す（`dish-media-imports.service.ts` の `area_not_provided`）。エリアを送っていなかったので
**店舗候補は構造的に必ず 0 件**で、候補からしか選べない UI だったため保存に到達できなかった。

直し方は 2 つセットでないと意味が無い。

1. **エリアを送る** … 現在地を best-effort で取り、`lat` / `lng` / `radius` を付ける。
   取れなくてもエラーにしない（権限拒否は普通に起きる）
2. **手入力へ縮退する口を常に出す** … 候補が 0 件でも、店名検索（自前 `restaurants`）と
   料理カテゴリ検索から選べる。設計の「完全自動確定を前提にしない」がこれである。
   Instagram はサーバから取れるメタデータが無い（`metadata_provider_unsupported`）ので、
   **候補が 0 件になるのは異常系ではなく想定内の主要経路**である

## サーバへ渡すのは «貼られた文字列» そのもの
provider や externalContentId をクライアントで組み立てて送らない。サーバ側（`resolve` /
`imports`）が同じ `shared/utils/snsUrl.ts` で解釈し直すので、判定を 2 箇所に持たない。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	PanResponder,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { Instagram, MapPin, MapPinned, Music2, Youtube } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import i18n from "@/lib/i18n";
import { resolveSnsShareIntakeView } from "@/lib/snsShareIntake";
import { getCurrentLocationPosition } from "@/hooks/useCurrentLocationPosition";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { RestaurantNameSearch } from "@/features/restaurantPicker/components/RestaurantNameSearch";
import {
	usePickedRestaurantStore,
	type PickedRestaurant,
} from "@/features/restaurantPicker/stores/usePickedRestaurantStore";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";
import type { Region } from "react-native-maps";
import type { SnsProvider } from "@shared/utils/snsUrl";
import type { CreateDishMediaImportDto, ResolveDishMediaImportDto } from "@shared/api/v1/dto";
import type { CreateDishMediaImportResponse, ResolveDishMediaImportResponse } from "@shared/api/v1/res";

/**
 * provider の表示名。**固有名詞なので翻訳しない**（8 ロケールへ同じ値を 3 つずつ置くと、
 * 表記ゆれが入る余地だけが増える）。文章に混ざる形の文言は locale ファイル側に置いてある。
 */
const PROVIDER_LABELS: Record<SnsProvider, string> = {
	instagram: "Instagram",
	tiktok: "TikTok",
	youtube: "YouTube Shorts",
};

/**
 * provider 名の左に添えるロゴ（#1375 4 巡目の実機指摘）。
 * lucide に TikTok の公式グリフは無いので音符（Music2）で代用する。
 */
const PROVIDER_ICONS: Record<SnsProvider, typeof Instagram> = {
	instagram: Instagram,
	tiktok: Music2,
	youtube: Youtube,
};

/**
 * キャプションを畳んだとき（3 行）に収まりきらない可能性が高い条件。
 *
 * 独立レビュー指摘: 文字数だけで判定すると「改行が多く 1 行が短い」店舗情報型の
 * キャプション（このフィーチャーの主対象）が 120 文字未満のまま 3 行を超え、
 * 「もっと見る」が出ずに住所行が読めなくなる。`onTextLayout` は react-native-web で
 * 発火が不安定なため、文字数 or 改行数のヒューリスティックで判定する
 */
const shouldOfferCaptionToggle = (title: string): boolean =>
	title.length > 120 || (title.match(/\n/g)?.length ?? 0) >= 3;

/**
 * 店舗候補を探す半径（m）。
 *
 * SNS の URL には座標が無いので、エリアは «いまユーザーが居る場所» を使うほかない
 * （設計 骨子 Q-3）。5km は「その辺で見つけた店を取り込む」に効く広さで、
 * これ以上広げても照合対象の上限（200 件）で頭打ちになるだけ精度が上がらない。
 */
const RESOLVE_RADIUS_M = 5000;

/** 上部タブ。`sns` が既定（＝ ＋ ボタンの基本導線） */
const TABS = ["sns", "eaten"] as const;
type Tab = (typeof TABS)[number];

/**
 * 手順の見出し。**番号 + 見出し** の形にする（#1375 実機確認 2 巡目）。
 *
 * 1 巡目は「料理」「店舗」という単語が同じ大きさで縦に並ぶだけで、貼る → 読み取る → 選ぶ →
 * 保存する、という順番が画面から読み取れなかった（«簡素すぎる» の中身はこれである）。
 */
function StepHeading({ step, title, testID }: { step: number; title: string; testID?: string }) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.stepHeading} testID={testID}>
			<View style={styles.stepBadge}>
				<Text style={styles.stepBadgeText}>{step}</Text>
			</View>
			<Text style={styles.stepTitle}>{title}</Text>
		</View>
	);
}

export default function SnsImportScreen() {
	useScreenTrace("SnsImport");
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { user } = useAuth();
	const { url: urlParam } = useLocalSearchParams<{ url?: string }>();

	const sharedUrl = typeof urlParam === "string" ? urlParam : null;

	const [tab, setTab] = useState<Tab>("sns");
	// useFocusEffect のコールバックは初回の closure のまま呼ばれるので、最新タブは ref で読む
	const tabRef = useRef(tab);
	tabRef.current = tab;
	/** 貼り付け欄。共有から来たときは初期値が入る */
	const [input, setInput] = useState<string>(sharedUrl ?? "");
	const [resolved, setResolved] = useState<ResolveDishMediaImportResponse | null>(null);
	// #1375 4 巡目: キャプションは畳んで出し、「もっと見る」で全文を見られるようにする
	const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
	const [isResolving, setIsResolving] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	// 連打の同期ガード（表示用の isSaving とは役割を分ける）
	const isSavingRef = useRef(false);
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(null);
	const [restaurantId, setRestaurantId] = useState<string | null>(null);
	/** 選択済みの表示名。候補からでも手入力からでも、選んだものが見えるようにする */
	const [dishCategoryLabel, setDishCategoryLabel] = useState<string | null>(null);
	const [restaurantName, setRestaurantName] = useState<string | null>(null);

	/**
	 * 店舗候補・店名検索に使うエリア。**取れなくても止めない**（権限拒否は普通に起きる）。
	 * 既定は日本の中心付近で、店名検索は全国から拾えないので現在地が取れたときだけ意味を持つ。
	 */
	const regionRef = useRef<Region>({
		latitude: 35.6812,
		longitude: 139.7671,
		latitudeDelta: 0.05,
		longitudeDelta: 0.05,
	});
	const [area, setArea] = useState<{ lat: number; lng: number } | null>(null);
	useEffect(() => {
		let cancelled = false;
		getCurrentLocationPosition()
			.then(({ latitude, longitude }) => {
				if (cancelled) return;
				regionRef.current = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
				setArea({ lat: latitude, lng: longitude });
			})
			// 権限拒否・タイムアウトはここでは何も出さない。候補が減るだけで、手入力へ縮退できる
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	// 料理カテゴリの手入力（候補が 0 件でも選べるようにするための口）
	const { suggestions: dishCategorySuggestions, searchDishCategories } = useDishCategorySearch();
	const [dishCategoryQuery, setDishCategoryQuery] = useState("");

	// 共有から来たときの入力欄の初期値。`?url=` は起動経路によって遅れて届くことがある
	useEffect(() => {
		if (sharedUrl) setInput(sharedUrl);
	}, [sharedUrl]);

	/**
	 * 貼られた文字列の «見た目» の判定。API を叩く前にここで弾けるものは弾く。
	 * ⚠️ これは表示のための判定で、**取り込みの可否を決めるのはサーバ**である。
	 */
	const view = useMemo(() => resolveSnsShareIntakeView(input.trim() || null), [input]);

	/**
	 * #1375 実機確認: **下へ引いて閉じる。** ヘッダを出さない代わりの戻る導線である。
	 *
	 * ⚠️ 本物のボトムシート（オーバーレイ）にはしていない。`Portal.Host` が `<Stack>` を
	 * 包んでいるため、オーバーレイを開いたまま push すると遷移先が下に潜る（#1364 で実測）。
	 * この画面は「食べたを記録」から店舗選択へ push するので、そこを踏む。
	 * ルートのまま **ジェスチャだけ** ボトムシート相当にしてある。
	 *
	 * ⚠️ ジェスチャは «つまみの帯» にだけ付ける。画面全体に付けると、下のスクロールや
	 * 入力欄のドラッグを奪う。`onMoveShouldSetPanResponder` で下方向の動きだけを拾い、
	 * 横方向・上方向は素通しにしている。
	 */
	const DISMISS_DISTANCE = 80;
	const dismissGesture = useMemo(
		() =>
			PanResponder.create({
				onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
				onPanResponderRelease: (_event, gesture) => {
					if (gesture.dy > DISMISS_DISTANCE) handleBackRef.current();
				},
			}),
		[],
	);

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "sns_import_screen_back_pressed",
			error_level: "log",
			payload: { state: view.state },
		});
		// 共有からの着地は履歴が無いことがある（ログイン往復の replace / コールドスタート）。
		// その場合は my-dishes（取り込んだものが並ぶ場所）へ倒す
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(`/${locale}/my-dishes`);
	}, [lightImpact, locale, logFrontendEvent, view.state]);

	// PanResponder は 1 度だけ作る（毎レンダー作り直すとジェスチャが途中で切れる）ので、
	// 最新の `handleBack` は ref 経由で読む
	const handleBackRef = useRef(handleBack);
	useEffect(() => {
		handleBackRef.current = handleBack;
	}, [handleBack]);

	/**
	 * 「食べたを記録」タブ。こちらは **公開レビューの投稿**なのでログインが要る
	 * （`dish_reviews` を書く経路であり、取り込みとは別物である）。
	 */
	const handleSelectTab = useCallback(
		(next: Tab) => {
			if (next === tab) return;
			lightImpact();
			if (next === "eaten" && isGuestUser(user)) {
				router.push({
					pathname: "/[locale]/auth/login",
					params: { locale, next: `/${locale}/sns-import` },
				});
				return;
			}
			// #1375（3 巡目）「食べたを記録」は別画面へ push しない。**このタブの中が
			// レビュー入力フォーム**である（お店を選ぶ → メディア → 一言レビュー・料理
			// カテゴリー・料金・おすすめ度）。以前の «select-restaurant へ push» は
			// 閉じられない・戻ると検索へ飛ぶ・スタックが積み上がる、と実機で指摘された
			setTab(next);
		},
		[lightImpact, locale, tab, user],
	);

	const handleResolve = useCallback(async () => {
		const url = input.trim();
		if (!url || isResolving) return;
		lightImpact();
		setIsResolving(true);
		setResolved(null);
		setDishCategoryId(null);
		setRestaurantId(null);
		setDishCategoryLabel(null);
		setRestaurantName(null);
		try {
			// ⚠️ **エリアを必ず付ける。** `lat` / `lng` / `radius` が揃っていないとサーバは
			// 店舗候補を 1 件も探さない（`area_not_provided`）。取れなかったときは付けずに投げ、
			// 候補ゼロのまま手入力へ縮退させる（エラーにはしない）
			const response = await callBackend<ResolveDishMediaImportDto, ResolveDishMediaImportResponse>(
				"v1/dish-media/imports/resolve",
				{
					method: "POST",
					requestPayload: area ? { url, lat: area.lat, lng: area.lng, radius: RESOLVE_RADIUS_M } : { url },
				},
			);
			setResolved(response);
			// 読み取り直しでキャプションは畳み直す（前の投稿の展開状態を引き継がない）
			setIsCaptionExpanded(false);
			// 閾値を超えた候補があれば初期選択に使う。**それでもユーザーが直せる状態で見せる**
			setDishCategoryId(response.prefill.dishCategoryId);
			setRestaurantId(response.prefill.restaurantId);
			// 表示名はチップと同じ規則で **ユーザーの言語を優先**する。labelEn 直参照にすると
			// 日本語 UI の中に「選択中: Miso ramen」だけ英語が混ざる（実 UI レビューで発見）
			const prefillCategory = response.candidates.dishCategories.find(
				(c) => c.dishCategoryId === response.prefill.dishCategoryId,
			);
			setDishCategoryLabel(
				prefillCategory
					? (prefillCategory.labels?.[locale.split("-")[0]] ??
							prefillCategory.labelEn ??
							prefillCategory.dishCategoryId)
					: null,
			);
			setRestaurantName(
				response.candidates.restaurants.find((c) => c.restaurantId === response.prefill.restaurantId)?.name ?? null,
			);
			logFrontendEvent({
				event_name: "sns_import_resolved",
				error_level: "log",
				// URL そのものは payload に入れない（#1403 の「個人を特定しうる値を入れない」に従う）
				payload: {
					status: response.status,
					reason: response.reason,
					provider: response.source.provider,
					dishCategoryCandidateCount: response.candidates.dishCategories.length,
					restaurantCandidateCount: response.candidates.restaurants.length,
				},
			});
		} catch {
			showSnackbar(i18n.t("Common.errors.unexpected"));
		} finally {
			setIsResolving(false);
		}
	}, [area, callBackend, input, isResolving, lightImpact, locale, logFrontendEvent, showSnackbar]);

	/** 店名検索（自前 `restaurants`）から選んだ。候補が 0 件でもここから必ず選べる */
	const handleSelectRestaurantFromSearch = useCallback(
		(result: QueryRestaurantsResponse[number]) => {
			lightImpact();
			setRestaurantId(result.restaurant.id);
			setRestaurantName(result.restaurant.name);
		},
		[lightImpact],
	);

	/**
	 * #1375 実機確認: 地図で選んだお店を受け取る。
	 *
	 * 店名検索（自前 `restaurants`）が空振りしたときの逃げ道が «地図のお店をタップ» なのに、
	 * この画面には地図が無かった。地図は select-restaurant の pick モードに任せ、
	 * 結果は `usePickedRestaurantStore` 経由で 1 回だけ受け取る（`router.back()` は
	 * パラメータを持てず、`replace` すると貼り付け済みの URL が消えるため）。
	 */
	const handleOpenMapPicker = useCallback(() => {
		lightImpact();
		// #1375（3 巡目）地図は select-restaurant の pick モード。保存したお店のリスト付きで、
		// 選んだら push せずにここへ戻ってくる。
		// ⚠️ (tabs) 側のルートへ push しない。この画面はルート Stack のモーダルなので、
		// タブ側に積むと **モーダルの背面**で遷移して「閉じられない・戻ると検索へ行く」になる
		// （実機で発生）。ルート Stack に置いた別名ルート（pick-restaurant）を使う
		router.push({
			pathname: "/[locale]/pick-restaurant",
			params: { locale, mode: "pick" },
		});
	}, [lightImpact, locale]);

	/** 食べたを記録タブで選んだお店（ReviewForm へ渡す restaurants の行ごと持つ） */
	const [eatenRestaurant, setEatenRestaurant] = useState<PickedRestaurant | null>(null);

	/** 記録できたら my-dishes を無効化してシートを閉じる（記録したものが並ぶ場所へ帰す） */
	const handleEatenSuccess = useCallback(() => {
		bumpMyDishesRevision();
		showSnackbar(i18n.t("SnsImport.eaten.done"));
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(`/${locale}/my-dishes`);
	}, [locale, showSnackbar]);

	useFocusEffect(
		useCallback(() => {
			const picked = usePickedRestaurantStore.getState().consume();
			if (picked === null) return;
			// どちらのタブの «お店を選ぶ» から地図へ行ったかで受け手が変わる
			if (tabRef.current === "eaten") {
				setEatenRestaurant(picked);
				return;
			}
			setRestaurantId(picked.restaurantId);
			setRestaurantName(picked.name);
		}, []),
	);

	/** 料理カテゴリ検索から選んだ。同上 */
	const handleSelectDishCategoryFromSearch = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			lightImpact();
			setDishCategoryId(suggestion.dishCategoryId);
			setDishCategoryLabel(suggestion.label);
			setDishCategoryQuery("");
		},
		[lightImpact],
	);

	const handleSave = useCallback(async () => {
		const url = input.trim();
		// ⚠️ `isSaving`（state）は同一フレーム内の連打を弾けない（ReviewForm #1090 /
		// ActionButtons #1205 と同じ既知パターン）。同期 ref で先に閉める
		if (!url || !dishCategoryId || !restaurantId || isSaving || isSavingRef.current) return;
		isSavingRef.current = true;
		lightImpact();
		setIsSaving(true);
		try {
			const response = await callBackend<CreateDishMediaImportDto, CreateDishMediaImportResponse>(
				"v1/dish-media/imports",
				{ method: "POST", requestPayload: { url, dishCategoryId, restaurantId } },
			);
			logFrontendEvent({
				event_name: "sns_import_completed",
				error_level: "log",
				payload: { created: response.created, saved: response.saved },
			});
			showSnackbar(i18n.t("SnsImport.save.done"));
			// 取り込んだものが並ぶ場所へ送る。戻るで取り込み画面へ戻らないよう replace する
			router.replace(`/${locale}/my-dishes`);
		} catch {
			showSnackbar(i18n.t("SnsImport.save.failed"));
		} finally {
			isSavingRef.current = false;
			setIsSaving(false);
		}
	}, [callBackend, dishCategoryId, input, isSaving, lightImpact, locale, logFrontendEvent, restaurantId, showSnackbar]);

	const canSave = dishCategoryId !== null && restaurantId !== null && !isSaving;

	return (
		<SafeAreaView edges={["bottom"]} style={styles.container} testID="sns-import-screen">
			{/* #1375 実機確認: **ヘッダは出さない。** タブ自体が見出しの役割を持つので、
			    その上にもう 1 段タイトル帯を置くと «同じことを 2 回言う» 形になる。
			    戻る導線はヘッダではなく «下へ引いて閉じる»（`dismissGesture`）が担う。

			    ⚠️ 戻る手段を 1 つも持たない画面にしない。ジェスチャが効かない環境
			    （web・アクセシビリティ操作）のために、読み上げ用の閉じるボタンを
			    画面外に置かず **つまみ自体をボタンにして**ある */}
			<View style={styles.grabberArea} {...dismissGesture.panHandlers}>
				<TouchableOpacity
					testID="sns-import-screen-back"
					onPress={handleBack}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.close")}
					style={styles.grabberHitArea}>
					<View style={styles.grabber} />
				</TouchableOpacity>
			</View>

			{/* #1375 実機確認: ＋ の基本導線は SNS 取り込み。上部タブで「食べた」の追加へ切り替える。
			    背景は敷かず、選択中だけ濃い黒＋下線で示す */}
			<View style={styles.tabRow}>
				{TABS.map((t) => (
					<TouchableOpacity
						key={t}
						testID={`sns-import-tab-${t}`}
						onPress={() => handleSelectTab(t)}
						accessibilityRole="button"
						accessibilityState={{ selected: tab === t }}
						style={styles.tab}>
						<Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{i18n.t(`SnsImport.tabs.${t}`)}</Text>
						{/* 下線は «選択中のときだけ» 描く。常に描いて色を変える形にすると、
						    非選択のタブにも薄い線が残って «どれが選ばれているか» が弱くなる */}
						{tab === t && <View style={styles.tabUnderline} />}
					</TouchableOpacity>
				))}
			</View>

			{tab === "eaten" ? (
				/* #1375（3 巡目）食べたを記録 = このタブの中のレビュー入力フォーム。
				   1. お店を選ぶ（pick モードの地図。保存したお店リスト付き。選んだらここへ戻る）
				   2. お店が決まったら ReviewForm（メディア選択 → 一言レビュー・料理カテゴリー・
				      料金・おすすめ度）。写真なしでも記録できる（allowNoMedia） */
				<View style={styles.eatenContainer} testID="sns-import-eaten-form">
					<TouchableOpacity
						testID="sns-import-eaten-pick-restaurant"
						onPress={handleOpenMapPicker}
						accessibilityRole="button"
						style={styles.eatenRestaurantRow}>
						<MapPinned size={18} color={colors.textSecondaryStrong} />
						<Text
							style={[styles.eatenRestaurantLabel, eatenRestaurant === null && styles.eatenRestaurantPlaceholder]}
							numberOfLines={1}>
							{eatenRestaurant?.name ?? i18n.t("SnsImport.eaten.pickRestaurant")}
						</Text>
						<Text style={styles.eatenRestaurantChange}>
							{i18n.t(eatenRestaurant === null ? "SnsImport.eaten.pick" : "SnsImport.eaten.change")}
						</Text>
					</TouchableOpacity>

					{eatenRestaurant?.restaurant ? (
						<ReviewForm
							key={eatenRestaurant.restaurantId}
							restaurant={eatenRestaurant.restaurant}
							allowNoMedia
							onCancel={() => setEatenRestaurant(null)}
							onSuccess={handleEatenSuccess}
						/>
					) : (
						<Text style={styles.eatenHint} testID="sns-import-eaten-hint">
							{i18n.t("SnsImport.eaten.hint")}
						</Text>
					)}
				</View>
			) : (
				<>
					{/* #1375 実機確認（3 巡目）: 店名検索の入力がキーボードに隠れる。iOS はシート表示なので
			    behavior は padding が正しい（height だとシート内で二重に縮む） */}
					<KeyboardAvoidingView
						style={styles.keyboardAvoiding}
						behavior={Platform.OS === "ios" ? "padding" : undefined}>
						<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
							{/* #1375 実機確認（2 巡目）: 画面が «簡素すぎて何をすればよいか分からない» と言われた。
				    最初に «この画面で何ができるか» を 1 段落で言い、以降は 1〜3 の手順カードにする */}
							<Text style={styles.intro} testID="sns-import-intro">
								{i18n.t("SnsImport.intro")}
							</Text>

							<View style={styles.card}>
								<StepHeading step={1} title={i18n.t("SnsImport.steps.paste")} testID="sns-import-step-paste" />
								<Text style={styles.label}>{i18n.t("SnsImport.input.label")}</Text>
								<TextInput
									testID="sns-import-url-input"
									value={input}
									onChangeText={setInput}
									placeholder={i18n.t("SnsImport.input.placeholder")}
									autoCapitalize="none"
									autoCorrect={false}
									multiline
									style={styles.input}
								/>

								{/* 見た目の判定でも «非対応» と分かるものは、API を叩く前に言う */}
								{input.trim().length > 0 && view.state === "unsupported" && (
									<Text testID="sns-import-unsupported-description" style={styles.hint}>
										{i18n.t("SnsImport.unsupported.description")}
									</Text>
								)}
								{view.state === "expandPending" && (
									<Text testID="sns-import-expand-pending" style={styles.hint}>
										{i18n.t("SnsImport.expandPending.description")}
									</Text>
								)}

								{/* #1375 実機確認（3 巡目）: 読み取り後にボタンが元の見た目へ戻ると
					    «成功したのか失敗したのか分からない»。成功後はラベルを変え、
					    結果は下の `sns-import-result` が必ず何かを言う */}
								<PrimaryButton
									testID="sns-import-resolve-button"
									onPress={handleResolve}
									label={i18n.t(resolved !== null ? "SnsImport.actions.resolveAgain" : "SnsImport.actions.resolve")}
									loading={isResolving}
									disabled={input.trim().length === 0}
									style={styles.resolveButton}
								/>

								{isResolving && <ActivityIndicator style={styles.spinner} />}
							</View>

							{resolved && (
								<View testID="sns-import-result">
									{resolved.status === "unsupported" || resolved.status === "unavailable" ? (
										<Text testID="sns-import-result-error" style={styles.hint}>
											{i18n.t(`SnsImport.reasons.${resolved.reason}`, {
												defaultValue: i18n.t("SnsImport.unsupported.description"),
											})}
										</Text>
									) : (
										<>
											{!!resolved.source.provider &&
												(() => {
													// #1375 4 巡目: 名前だけだと素っ気ないのでロゴを左に添える
													const ProviderIcon = PROVIDER_ICONS[resolved.source.provider];
													return (
														<View style={styles.providerRow}>
															<ProviderIcon size={16} color={colors.brand} />
															<Text style={styles.provider} testID="sns-import-provider">
																{PROVIDER_LABELS[resolved.source.provider]}
															</Text>
														</View>
													);
												})()}
											{!!resolved.metadata.title && (
												<>
													<Text
														style={styles.metaTitle}
														testID="sns-import-caption"
														numberOfLines={isCaptionExpanded ? undefined : 3}>
														{resolved.metadata.title}
													</Text>
													{/* キャプション全文（店舗情報・メニューが書かれていることが多い）を
											    その場で読めるようにする。閾値以下なら 3 行に収まるので出さない */}
													{shouldOfferCaptionToggle(resolved.metadata.title) && (
														<TouchableOpacity
															testID="sns-import-caption-toggle"
															onPress={() => {
																lightImpact();
																setIsCaptionExpanded((prev) => !prev);
															}}
															accessibilityRole="button">
															<Text style={styles.captionToggle}>
																{i18n.t(
																	isCaptionExpanded
																		? "SnsImport.result.collapseCaption"
																		: "SnsImport.result.showFullCaption",
																)}
															</Text>
														</TouchableOpacity>
													)}
												</>
											)}
											{/* #1375 実機確認（3 巡目）: **読み取り後に何も出ないのを禁止する。**
								    Instagram はサーバから取れる情報が無いので、候補ゼロは主要経路である。
								    その場合も «読み取りは終わった。次はこうする» を必ず言う */}
											<Text style={styles.hint} testID="sns-import-result-summary">
												{resolved.candidates.dishCategories.length > 0 || resolved.candidates.restaurants.length > 0
													? i18n.t("SnsImport.result.summary")
													: i18n.t("SnsImport.result.noInfo")}
											</Text>
										</>
									)}
								</View>
							)}

							{/* #1375 実機確認（2 巡目）: 店舗と料理カテゴリの手順は **読み取り前から常に出す**。
				    以前は読み取り成功後にしか出なかったため、
				    - 候補ゼロ・API 失敗のとき «選ぶ手段» ごと画面から消える
				    - 「地図からお店を探す」導線が見えたり見えなかったりする（実機で指摘された）
				    の 2 つが起きていた。候補チップだけが読み取り結果に依存する。
				    並びは店舗 → 料理カテゴリ（実機指摘: 店舗を料理の上へ） */}
							<View style={styles.card}>
								<StepHeading
									step={2}
									title={i18n.t("SnsImport.steps.restaurant")}
									testID="sns-import-step-restaurant"
								/>
								{resolved !== null && resolved.candidates.restaurants.length > 0 && (
									<View style={styles.chipRow}>
										{resolved.candidates.restaurants.map((candidate) => (
											<TouchableOpacity
												key={candidate.restaurantId}
												testID={`sns-import-restaurant-${candidate.restaurantId}`}
												onPress={() => {
													lightImpact();
													setRestaurantId(candidate.restaurantId);
													setRestaurantName(candidate.name);
												}}
												accessibilityRole="button"
												accessibilityState={{ selected: restaurantId === candidate.restaurantId }}
												style={[styles.chip, restaurantId === candidate.restaurantId && styles.chipSelected]}>
												<Text
													style={[
														styles.chipLabel,
														restaurantId === candidate.restaurantId && styles.chipLabelSelected,
													]}>
													{candidate.name}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								)}

								{/* 店名検索（自前 `restaurants` テーブル。Google Places Text Search /
					    Autocomplete は呼ばない）。0 件のときは «地図から探す» を検索結果の中にも出す */}
								<RestaurantNameSearch
									regionRef={regionRef}
									onSelectRestaurant={handleSelectRestaurantFromSearch}
									emptyAction={{
										label: i18n.t("SnsImport.sections.pickOnMap"),
										onPress: handleOpenMapPicker,
										testID: "sns-import-restaurant-search-map-fallback",
									}}
									testID="sns-import-restaurant-search"
								/>
								{/* «地図から探す» は検索が空振りしたときの逃げ道でもあるので、常設でも見せる */}
								<TouchableOpacity
									testID="sns-import-pick-on-map"
									onPress={handleOpenMapPicker}
									accessibilityRole="button"
									style={styles.mapPickButton}>
									<MapPin size={16} color={colors.brand} />
									<Text style={styles.mapPickLabel}>{i18n.t("SnsImport.sections.pickOnMap")}</Text>
								</TouchableOpacity>
								{!!restaurantName && (
									<Text style={styles.selectedValue} testID="sns-import-selected-restaurant">
										{i18n.t("SnsImport.sections.selected", { value: restaurantName })}
									</Text>
								)}
							</View>

							<View style={styles.card}>
								<StepHeading step={3} title={i18n.t("SnsImport.steps.dish")} testID="sns-import-step-dish" />
								{resolved !== null && resolved.candidates.dishCategories.length > 0 && (
									<View style={styles.chipRow}>
										{resolved.candidates.dishCategories.map((candidate) => (
											<TouchableOpacity
												key={candidate.dishCategoryId}
												testID={`sns-import-dish-category-${candidate.dishCategoryId}`}
												onPress={() => {
													lightImpact();
													setDishCategoryId(candidate.dishCategoryId);
													setDishCategoryLabel(
														candidate.labels?.[locale.split("-")[0]] ?? candidate.labelEn ?? candidate.dishCategoryId,
													);
												}}
												accessibilityRole="button"
												accessibilityState={{ selected: dishCategoryId === candidate.dishCategoryId }}
												style={[styles.chip, dishCategoryId === candidate.dishCategoryId && styles.chipSelected]}>
												<Text
													style={[
														styles.chipLabel,
														dishCategoryId === candidate.dishCategoryId && styles.chipLabelSelected,
													]}>
													{candidate.labels?.[locale.split("-")[0]] ?? candidate.labelEn ?? candidate.dishCategoryId}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								)}

								{/* 料理カテゴリの手入力。候補の有無に関わらず常に出す */}
								<TextInput
									testID="sns-import-dish-category-search-input"
									value={dishCategoryQuery}
									onChangeText={(text) => {
										setDishCategoryQuery(text);
										void searchDishCategories(text);
									}}
									placeholder={i18n.t("SnsImport.sections.dishCategorySearchPlaceholder")}
									autoCapitalize="none"
									style={styles.searchInput}
								/>
								{dishCategorySuggestions.length > 0 && (
									<View style={styles.chipRow}>
										{dishCategorySuggestions.map((suggestion) => (
											<TouchableOpacity
												key={suggestion.dishCategoryId}
												testID={`sns-import-dish-category-suggestion-${suggestion.dishCategoryId}`}
												onPress={() => handleSelectDishCategoryFromSearch(suggestion)}
												accessibilityRole="button"
												style={styles.chip}>
												<Text style={styles.chipLabel}>{suggestion.label}</Text>
											</TouchableOpacity>
										))}
									</View>
								)}
								{!!dishCategoryLabel && (
									<Text style={styles.selectedValue} testID="sns-import-selected-dish-category">
										{i18n.t("SnsImport.sections.selected", { value: dishCategoryLabel })}
									</Text>
								)}
							</View>
						</ScrollView>

						{/* #1375 実機確認（2 巡目）: 保存はスクロールの一番下ではなく **常に見えるところ**に置く。
			    候補と検索欄が縦に伸びる画面なので、下端に埋めると «選んだのに保存が見つからない» になる。
			    読み取り前は出さない（押せないボタンだけが浮いていても意味が無い） */}
						{input.trim().length > 0 && (
							<View style={styles.footer}>
								{!canSave && !isSaving && (
									<Text style={styles.footerHint}>{i18n.t("SnsImport.actions.saveRequirement")}</Text>
								)}
								<PrimaryButton
									testID="sns-import-save-button"
									onPress={handleSave}
									label={i18n.t("SnsImport.actions.save")}
									loading={isSaving}
									disabled={!canSave}
								/>
							</View>
						)}
					</KeyboardAvoidingView>
				</>
			)}
		</SafeAreaView>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）
const createStyles = (c: Palette) =>
	StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: c.surface,
	},
	grabberArea: {
		paddingTop: 8,
		paddingBottom: 4,
		alignItems: "center",
	},
	grabberHitArea: {
		paddingVertical: 8,
		paddingHorizontal: 24,
	},
	grabber: {
		width: 40,
		height: 4,
		borderRadius: 2,
		backgroundColor: c.trackMuted,
	},
	tabRow: {
		flexDirection: "row",
		gap: 20,
		paddingHorizontal: 16,
		paddingBottom: 4,
	},
	// #1375 実機確認（2 巡目）: 「上部のボタンの位置がズレている」の中身。
	// 以前は `tabRow` の gap 20 に加えてタブ自身が `paddingRight: 20` を持っていたので、
	// ラベル間の余白が左右で食い違い、さらに下線（`alignSelf: "stretch"`）が
	// その padding のぶんだけ右へはみ出してラベルと揃わなかった。
	// 余白は `tabRow` の gap だけが持ち、タブの幅 = ラベルの幅 に揃える
	tab: {
		paddingVertical: 10,
		alignItems: "stretch",
	},
	tabLabel: {
		fontSize: 22,
		fontWeight: "700",
		// 非選択は «薄い黒»。別の色にすると «押せない» ように見える
		color: c.textTertiary,
	},
	tabLabelActive: {
		color: c.textPrimaryAlt,
	},
	tabUnderline: {
		marginTop: 6,
		height: 3,
		borderRadius: 2,
		alignSelf: "stretch",
		backgroundColor: c.textPrimaryAlt,
	},
	keyboardAvoiding: {
		flex: 1,
	},
	eatenContainer: {
		flex: 1,
		paddingTop: 8,
	},
	eatenRestaurantRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginHorizontal: 16,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: c.borderMuted,
		backgroundColor: c.surface,
	},
	eatenRestaurantLabel: {
		flex: 1,
		fontSize: 15,
		fontWeight: "700",
		color: c.textPrimaryAlt,
	},
	eatenRestaurantPlaceholder: {
		color: c.textTertiary,
		fontWeight: "400",
	},
	eatenRestaurantChange: {
		fontSize: 13,
		fontWeight: "700",
		color: c.brand,
	},
	eatenHint: {
		marginTop: 12,
		marginHorizontal: 16,
		fontSize: 13,
		lineHeight: 19,
		color: c.textSecondary,
	},
	content: {
		paddingHorizontal: 16,
		paddingBottom: 32,
	},
	intro: {
		marginTop: 12,
		fontSize: 13,
		lineHeight: 19,
		color: c.textSecondary,
	},
	// 手順ごとの器。枠を描くと «ここまでが 1 つの手順» が目で分かる
	card: {
		marginTop: 16,
		padding: 14,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: c.borderMuted,
		backgroundColor: c.surface,
	},
	stepHeading: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginBottom: 10,
	},
	stepBadge: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: c.textPrimaryAlt,
		alignItems: "center",
		justifyContent: "center",
	},
	stepBadgeText: {
		fontSize: 12,
		fontWeight: "700",
		// 地（stepBadge）が textPrimaryAlt なので、文字は CTA と同じ反転規則で振る
		color: c.ctaLabel,
	},
	stepTitle: {
		fontSize: 15,
		fontWeight: "700",
		color: c.textPrimaryAlt,
	},
	mapPickButton: {
		marginTop: 10,
		alignSelf: "flex-start",
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: c.brandTintAlt,
	},
	mapPickLabel: {
		fontSize: 13,
		fontWeight: "700",
		color: c.brand,
	},
	footer: {
		gap: 8,
		paddingHorizontal: 16,
		paddingTop: 12,
		paddingBottom: 12,
		borderTopWidth: 1,
		borderTopColor: c.dividerMuted,
		backgroundColor: c.surface,
	},
	footerHint: {
		fontSize: 12,
		color: c.textSecondary,
	},
	label: {
		marginTop: 12,
		fontSize: 13,
		color: c.textSecondary,
	},
	input: {
		marginTop: 6,
		minHeight: 72,
		borderWidth: 1,
		borderColor: c.borderMuted,
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 14,
		color: c.textPrimaryAlt,
		textAlignVertical: "top",
	},
	resolveButton: {
		marginTop: 16,
	},
	saveButton: {
		marginTop: 20,
	},
	spinner: {
		marginTop: 16,
	},
	providerRow: {
		marginTop: 20,
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	provider: {
		fontSize: 14,
		fontWeight: "700",
		color: c.brand,
	},
	captionToggle: {
		marginTop: 4,
		fontSize: 13,
		fontWeight: "700",
		color: c.textSecondary,
	},
	metaTitle: {
		marginTop: 4,
		fontSize: 14,
		lineHeight: 20,
		color: c.textSecondaryStrong,
	},
	sectionTitle: {
		marginTop: 20,
		fontSize: 14,
		fontWeight: "700",
		color: c.textPrimary,
	},
	searchInput: {
		marginTop: 8,
		borderWidth: 1,
		borderColor: c.borderMuted,
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 14,
		color: c.textPrimaryAlt,
	},
	selectedValue: {
		marginTop: 8,
		fontSize: 13,
		fontWeight: "700",
		color: c.brand,
	},
	chipRow: {
		marginTop: 8,
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
	chip: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: c.surfaceSubtle,
	},
	chipSelected: {
		backgroundColor: c.brandTintAlt,
	},
	chipLabel: {
		fontSize: 13,
		color: c.textSecondaryStrong,
	},
	chipLabelSelected: {
		color: c.brand,
		fontWeight: "700",
	},
	hint: {
		marginTop: 12,
		fontSize: 13,
		lineHeight: 19,
		color: c.textSecondary,
	},
	});
