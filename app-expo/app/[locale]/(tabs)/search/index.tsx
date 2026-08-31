import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import {
	MapPin,
	Search,
	SunMoon,
	Users,
	Navigation,
	Ruler,
	DollarSign,
	Plus,
	ChevronUp,
	ChefHat,
	HelpCircle,
	Timer,
} from "lucide-react-native";
import { router } from "expo-router";
import type { ExternalPathString } from "expo-router";
import { SearchParams } from "@/types/search";
import type { AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { LocationPermissionError, type LocationPermissionErrorKind } from "@/hooks/locationPermissionError";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { getAddressCountryCode } from "@/lib/addressFormat";
import { toErrorLogString } from "@/lib/errorMessage";
import {
	LocationAutocomplete,
	type LocationAutocompleteHandle,
	type RecentLocation,
} from "@/components/LocationAutocomplete";
import {
	timeSlots,
	sceneOptions,
	foodStyleOptions,
	diningPaceOptions,
	priceLevelOptions,
	PRELOAD_IMAGES,
} from "@/features/search/constants";
import { DistanceSlider } from "@/features/search/components/DistanceSlider";
import { PriceLevelsMultiSelect } from "@/features/search/components/PriceLevelsMultiSelect";
import { SelectableGridItem } from "@/features/search/components/SelectableGridItem";
import { SelectableChip } from "@/features/search/components/SelectableChip";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_SEARCH_RADIUS } from "@/features/dishCategories/constants";
import { useOnboardingSeen } from "@/features/onboarding/hooks/useOnboardingSeen";
import { wasDeniedInOnboarding } from "@/features/onboarding/permissionOutcomes";
import { onboardingIndexPath } from "@/features/onboarding/navigation";
import { useAutoCurrentLocation } from "@/features/search/hooks/useAutoCurrentLocation";
import { getSavedSearchConditions, saveSearchConditions } from "@/features/search/stores/useSearchConditionsStore";
import { useRecentLocations } from "@/features/search/hooks/useRecentLocations";
import { Image } from "expo-image";
import { useE2EPreloadProbe } from "@/lib/e2e/preloadProbe";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useIsFocused } from "@react-navigation/native";
import { useContentWidth } from "@/hooks/useContentWidth";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #667 【設計】画面幅ベースでアイテムサイズを計算（4列グリッド）
// #958 【修正】Dimensions.get("window") はモジュール評価時に1回だけ計算されリサイズに
// 追従しないうえ、web ではウィンドウ実幅であって CenteredAppShell が収める中央カラム幅とは
// 一致しない。ITEM_WIDTH の計算は useContentWidth() を使いコンポーネント内で行う
const HORIZONTAL_PADDING = 16;
const ITEM_PADDING = 3;
const BORDER_WIDTH = 2;
const ITEM_GAP = 2;
const NUM_COLUMNS = 4;

// #1196 【仕様】推薦 API を呼んでよい唯一の国。
//
// 料理カテゴリ推薦 API (`GET /v1/dish-categories/recommendations`) は address を
// カンマ分割して `region:` を前置し、`dish_category_features(feature_type='gate')` の
// `feature_key` と照合する。そのホワイトリストに入っている国は `region:country:JP` **だけ**
// （他は国に依らない `region:scope:global` のみ）。つまり海外の地点で呼ぶと候補が痩せて
// ほぼ 0 件になり、Claude フォールバックへ落ちる — 課金が発生するのに結果は返せない。
//
// ⚠️ **これを増やしたり分岐ロジックにしたりしないこと。** 対応国が増えるのは
// サーバ側の gate に `region:country:XX` が積まれたときだけで、その判断はサーバの
// マスタデータが持つ。クライアント側に国ごとの設定機構を作ると両者が必ずズレる。
const SUPPORTED_COUNTRY_CODE = "JP";

// #934 【設計】各セクション見出し。accessibilityRole="header" を持たせ、必須バッジは
// 別要素として視覚表示しつつスクリーンリーダー向けには見出しの accessibilityLabel に合成する
// (別々に読み上げられるより「(必須)」まで一続きで聞こえた方が分かりやすいため)
function SectionHeader({ icon, title, required }: { icon: React.ReactNode; title: string; required?: boolean }) {
	const styles = useThemedStyles(createStyles);
	const label = required ? `${title} (${i18n.t("Search.required")})` : title;
	return (
		<View style={styles.sectionHeader}>
			{icon}
			<Text style={styles.sectionTitle} accessibilityRole="header" accessibilityLabel={label}>
				{title}
			</Text>
			{required && (
				<View style={styles.requiredBadge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
					<Text style={styles.requiredText}>{i18n.t("Search.required")}</Text>
				</View>
			)}
		</View>
	);
}

export default function SearchScreen() {
	// #1016 【設計】主要画面(検索タブ)にFirebase Performance Monitoringの画面トレースを計装する。
	useScreenTrace("Search");
	// #1509 検索フォームは起動直後に必ず通る画面なので、基盤と同じ PR でテーマ対応する
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { locale, isJapanese } = useLocale();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	/*
	#1629【オーナー実機報告】キーボードで入力欄が隠れる件の横断対応。
	この画面の «どのあたりで探す？» はスクロールの途中にあるので、キーボードが出ると
	その下へ入りうる。高さを直接もらって下へ余白を足す（`hooks/useKeyboardInset.ts`）。
	*/
	const keyboardInset = useKeyboardInset();
	// #1375 実機確認（5 巡目）「保存スナックバーの『見る』で食べたい/食べたへ行き、
	// 探すへ戻ると条件が全部消えている」への対処。条件は画面の外（store）に置き、
	// 画面が作り直されても «前回の続き» から始める。まだ一度も触っていなければ null で、
	// その場合だけ従来どおりの既定値を使う（初回の見た目は一切変えない）。
	// ⚠️ 復元するのは «人が選んだ条件» だけで、検索結果は復元しない（鮮度が落ちるため取り直す）
	const restoredConditionsRef = useRef(getSavedSearchConditions());
	const restored = restoredConditionsRef.current;
	const [location, setLocation] = useState<Omit<LocationDetailsResponse, "viewport"> | null>(
		restored?.location ?? null,
	);
	const [locationQuery, setLocationQuery] = useState(restored?.locationQuery ?? "");
	// #1502 【設計】候補選択→details取得(緯度経度の確定)は非同期なので、入力欄に文字が
	// 入っただけで検索ボタンが押せない理由が分からない、という詰みが実査で見つかった
	// (渋谷駅/2026-07-28)。「確認中」「確定」「失敗」を明示するための状態。
	const [locationConfirmationStatus, setLocationConfirmationStatus] = useState<
		"confirming" | "confirmed" | "error" | null
	>(null);
	// #1502 【設計】details取得の完了は非同期なので、後発の選択・クリア・現在地取得が先発の
	// 結果を上書きしてしまうレースがありうる(候補A選択→確認中→候補Bへ選び直す、等)。
	// 単調増加IDを「発行した要求」と突き合わせ、自分が最新でなければ結果を捨てる
	// (`hooks/useLocationSearch.ts` の `latestRequestIdRef` と同じパターン)。
	const locationConfirmationRequestIdRef = useRef(0);
	// #1502 【設計】確認失敗時の再試行のため、直前に選択した候補を保持する
	const lastLocationPredictionRef = useRef<AutocompleteLocation | null>(null);
	const [timeSlot, setTimeSlot] = useState<SearchParams["timeSlot"]>(restored?.timeSlot ?? "lunch");
	// #1375（5 巡目・独立レビュー A-3）人が自分で時間帯を選んだか。自動選択を止めてよいのはこのときだけ
	const [timeSlotTouched, setTimeSlotTouched] = useState(restored?.timeSlotTouched ?? false);
	// #533 【仕様】scene 初期値を solo に変更（レコメンドAPI必須化対応）
	const [scene, setScene] = useState<SearchParams["scene"]>(restored?.scene ?? "solo");
	const [taste, setTaste] = useState<SearchParams["taste"] | undefined>(restored?.taste);
	const [coreIngredient, setCoreIngredient] = useState<SearchParams["coreIngredient"] | undefined>(
		restored?.coreIngredient,
	);
	const [diningPace, setDiningPace] = useState<SearchParams["diningPace"] | undefined>(restored?.diningPace);
	const isSearchingRef = useRef(false);
	// #1196 【設計】海外未対応の告知が二重に積まれるのを防ぐ。
	// 多重検索防止の `isSearchingRef` はガードより後段にあるため、この経路には効かない
	// （ガードは早期 return するのでそこまで到達しない）。DialogProvider はキューなので、
	// 最初のダイアログが描画される前に連打されるとその回数だけ積まれ、同じ告知を何度も
	// 閉じさせることになる。confirm の Promise は OK / Cancel / Dismiss のいずれでも解決するので、
	// それを閉じた合図として使う。
	const isUnsupportedRegionNoticeOpenRef = useRef(false);
	const [distance, setDistance] = useState<number>(restored?.distance ?? DEFAULT_SEARCH_RADIUS);
	const [priceLevels, setPriceLevels] = useState<(typeof priceLevelOptions)[number]["value"][]>(
		restored?.priceLevels ?? [],
	);
	const [showAdvancedFilters, setShowAdvancedFilters] = useState(restored?.showAdvancedFilters ?? false);

	const { getCurrentLocation, getLocationDetails } = useLocationSearch();
	const { showSnackbar } = useSnackbar();
	// #1196 【設計】海外未対応の案内はスナックバーではなくダイアログで出す。
	// 「この地点では検索できない」は再入力を促す確定的な通知なので、数秒で消える表示だと
	// ユーザーは何も起きなかったように見え、同じ地点で押し続けることになる。
	//
	// showDialog ではなく confirm を使うのは、**OK 単独のボタンにするため**。
	// showDialog は kind:"custom" として Cancel / OK を無条件で 2 つ積む実装で、
	// 選択肢が無い告知なのに「キャンセル」が並んでしまう（DialogProvider.tsx の renderedActions）。
	// confirm は `showCancel: false` を解釈するので、告知専用の 1 ボタンにできる
	// （型定義のコメントにも「『確認』ではなく単なる通知にしたい場合など」とある）。
	// 返り値の Promise<boolean> は押されたボタンを表すだけで、ここでは分岐しないので捨てる。
	const { confirm } = useDialog();
	// #932 【設計】現在地取得の恒久的な失敗(権限拒否・未対応)時に手入力へ誘導するため
	const locationInputRef = useRef<LocationAutocompleteHandle>(null);

	// #953 【仕様】直近5件の地点をローカル保存し、地点未入力でのフォーカス時に再選択候補として出す
	// #1129 【設計】handleSelectRecentLocation が addRecentLocation を依存配列で参照するため、
	// 宣言はハンドラ定義より前に置く必要がある(useCallback の依存配列は定義時に評価されるため)
	const { recentLocations, addRecentLocation, clearRecentLocations } = useRecentLocations();

	// #958 【修正】中央カラム幅に追従する4列グリッドのアイテムサイズ
	const contentWidth = useContentWidth();
	const itemWidth = useMemo(
		() =>
			(contentWidth -
				HORIZONTAL_PADDING * 2 -
				ITEM_GAP * (NUM_COLUMNS - 1) -
				(ITEM_PADDING * 2 + BORDER_WIDTH * 2) * NUM_COLUMNS) /
			NUM_COLUMNS,
		[contentWidth],
	);

	useEffect(() => {
		// Screen view logging
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "search" },
		});

		// 端末時間帯に基づき timeSlot を自動設定
		// #1375 ただし **人が自分で選んでいたら**上書きしない
		// （夜に「昼」を選んで検索 → 保存の «見る» → 戻ると勝手に「夜」へ戻る、を防ぐ）。
		// ⚠️ 判定に «store が空でないか» を使わないこと。初回マウントで既定値を保存した瞬間に
		// 成立してしまい、2 度目以降のマウントで自動選択が二度と働かなくなる（独立レビュー A-3）
		if (restoredConditionsRef.current?.timeSlotTouched) return;
		const hour = new Date().getHours();
		const TIME_SLOTS: { until: number; slot: SearchParams["timeSlot"] }[] = [
			{ until: 5, slot: "late_night" },
			{ until: 10, slot: "morning" },
			{ until: 15, slot: "lunch" },
			{ until: 22, slot: "dinner" },
			{ until: 24, slot: "late_night" },
		];
		const slot = TIME_SLOTS.find((s) => hour < s.until)!.slot;
		setTimeSlot(slot);
	}, [logFrontendEvent]);

	// #1375 条件が変わるたびに store へ書き戻す。次にこの画面が作り直されたとき
	// （保存スナックバーの «見る» → `router.dismissAll()` など）ここから復元する。
	// ⚠️ 取得（queryKey）には一切関与しない。純粋に «画面の初期値» のための保存である
	useEffect(() => {
		saveSearchConditions({
			location,
			locationQuery,
			timeSlot,
			scene,
			taste,
			coreIngredient,
			diningPace,
			distance,
			priceLevels,
			showAdvancedFilters,
			timeSlotTouched,
		});
	}, [
		location,
		locationQuery,
		timeSlot,
		scene,
		taste,
		coreIngredient,
		diningPace,
		distance,
		priceLevels,
		showAdvancedFilters,
		timeSlotTouched,
	]);

	const handleLocationClear = () => {
		lightImpact();
		setLocation(null);
		setLocationQuery("");
		// #1502 進行中の確認結果が後から届いても無視させる
		locationConfirmationRequestIdRef.current += 1;
		setLocationConfirmationStatus(null);
		lastLocationPredictionRef.current = null;
		logFrontendEvent({
			event_name: "location_cleared",
			error_level: "log",
			payload: {},
		});
	};

	// #1502 【設計】手入力での書き換えは「未確定」であることが自明なので、直前の確認状態
	// (確認中/確定/失敗)は今のテキストに対応しなくなる。進行中の確認があれば無効化して idle へ戻す
	const handleLocationQueryChange = (text: string) => {
		setLocationQuery(text);
		if (locationConfirmationStatus !== null) {
			locationConfirmationRequestIdRef.current += 1;
			setLocationConfirmationStatus(null);
		}
	};

	const handleLocationSelect = async (prediction: AutocompleteLocation) => {
		logFrontendEvent({
			event_name: "location_selected",
			error_level: "log",
			payload: { placeId: prediction.place_id, mainText: prediction.mainText },
		});
		setLocationQuery(prediction.mainText);
		lastLocationPredictionRef.current = prediction;
		// #1502 このリクエストの identity を確保。完了時に最新でなければ結果を捨てる
		// (取得中に別の候補を選び直した場合に、先行する取得の結果が後から上書きしないようにする)
		const requestId = ++locationConfirmationRequestIdRef.current;
		setLocationConfirmationStatus("confirming");
		try {
			const locationDetails = await getLocationDetails(prediction);
			if (locationConfirmationRequestIdRef.current !== requestId) return;
			setLocation(locationDetails);
			// #1673 【仕様】確定しても入力欄の値は選んだ候補の mainText のまま変えない。
			// #1502 は確定の合図として値を prediction.text(候補の完全表記)へ置き換えていたが、
			// Google Autocomplete の text は languageCode: ja だと**日本語の住所順**で返るため
			// (mainText「渋谷駅」/ secondaryText「日本、東京都渋谷区」→ text「日本、東京都渋谷区 渋谷駅」)、
			// 主たる地名が末尾へ回り、入力欄の幅で切れると何を選んだのか読めなくなっていた。
			// オーナー判断(2026-08-28): 入力欄の変化による確定の合図は不要。確定は ✓ アイコンだけで伝える。
			// ⚠️ 「text = mainText + secondaryText」は成り立たない。表示に text を使い直さないこと。
			setLocationConfirmationStatus("confirmed");
			// #953 【仕様】details 取得に成功した地点だけを「最近使った場所」に保存する。
			// viewport はスプレッドすると型上は Omit していても実行時には残ってしまうため、明示的に除く。
			// #1673 保存する表示名も入力欄と同じ mainText に揃える(保存料理タブと同一の表記になる)
			const { viewport: _viewport, ...locationWithoutViewport } = locationDetails;
			addRecentLocation({ ...locationWithoutViewport, locationQuery: prediction.mainText });
		} catch (error) {
			if (locationConfirmationRequestIdRef.current !== requestId) return;
			logFrontendEvent({
				event_name: "location_selection_failed",
				error_level: "error",
				payload: { placeId: prediction.place_id, error: toErrorLogString(error) },
			});
			setLocationConfirmationStatus("error");
			showSnackbar(i18n.t("Search.errors.fetchLocation"));
		}
	};

	// #1502 地点確認の失敗時の再試行。直前に選択した候補で details 取得をやり直す
	const handleRetryLocationConfirmation = () => {
		const prediction = lastLocationPredictionRef.current;
		if (!prediction) return;
		void handleLocationSelect(prediction);
	};

	// #932 【設計】失敗理由(kind)ごとに文言を出し分ける。denied/unsupported は再試行しても
	// 解決しないため、手入力へ誘導するよう地点入力欄へフォーカスを移動する
	const getCurrentLocationErrorMessage = (kind: LocationPermissionErrorKind): string => {
		switch (kind) {
			case "denied":
				return i18n.t("Search.errors.getCurrentLocationDenied");
			case "unsupported":
				return i18n.t("Search.errors.getCurrentLocationUnsupported");
			case "timeout":
				return i18n.t("Search.errors.getCurrentLocationTimeout");
			case "unavailable":
			default:
				return i18n.t("Search.errors.getCurrentLocation");
		}
	};

	// #953 【仕様】最近使った場所は details API を呼び直さず、保存済みの location をそのまま復元する
	const handleSelectRecentLocation = useCallback(
		(recent: RecentLocation) => {
			logFrontendEvent({
				event_name: "recent_location_selected",
				error_level: "log",
				payload: { locationQuery: recent.locationQuery },
			});
			// #1502 進行中の候補確認(details取得)があれば無効化し、最近使った場所は
			// details を待たず即座に「確定」として表示する
			locationConfirmationRequestIdRef.current += 1;
			lastLocationPredictionRef.current = null;
			setLocation(recent);
			setLocationQuery(recent.locationQuery);
			setLocationConfirmationStatus("confirmed");
			// #1129 【仕様】再選択した地点を MRU(Most Recently Used)順で先頭へ引き上げる。
			// addRecentLocation は同一地点を除去してから先頭へ積むため、件数は増えない。
			// 保存タイミングはオートコンプリート選択時(handleLocationSelect)と揃えて「選択した瞬間」とする。
			addRecentLocation(recent);
		},
		[logFrontendEvent, addRecentLocation],
	);

	const handleUseCurrentLocation = async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "current_location_requested",
			error_level: "log",
			payload: {},
		});
		// #1502 進行中の候補確認(details取得)があれば無効化する
		locationConfirmationRequestIdRef.current += 1;
		lastLocationPredictionRef.current = null;
		try {
			const currentLocation = await getCurrentLocation();
			setLocation(currentLocation);
			setLocationQuery(i18n.t("Search.currentLocation"));
			setLocationConfirmationStatus("confirmed");
			logFrontendEvent({
				event_name: "current_location_success",
				error_level: "log",
				payload: { hasLocation: !!currentLocation },
			});
		} catch (error) {
			const kind: LocationPermissionErrorKind = error instanceof LocationPermissionError ? error.kind : "unavailable";
			logFrontendEvent({
				event_name: "current_location_failed",
				error_level: "error",
				payload: { error: toErrorLogString(error), kind },
			});
			showSnackbar(getCurrentLocationErrorMessage(kind));

			// #932 【設計】権限拒否・未対応は再試行しても解決しないため、手入力へ誘導する
			if (kind === "denied" || kind === "unsupported") {
				locationInputRef.current?.focus();
			}
		}
	};

	const handleSearch = useCallback(() => {
		// #533 【仕様】location, timeSlot, scene を必須化（レコメンドAPI必須化対応）
		if (!location) {
			showSnackbar(i18n.t("Search.errors.noLocationSelected"));
			return;
		}
		if (!timeSlot) {
			showSnackbar(i18n.t("Search.errors.noTimeSlotSelected"));
			return;
		}
		if (!scene) {
			showSnackbar(i18n.t("Search.errors.noSceneSelected"));
			return;
		}

		// #1196 【設計】ここから 2 段のガード。どちらも `router.push` へ進ませない
		// （= 推薦 API を一切呼ばない）。API は仕様どおり動いているので、呼ぶ／呼ばないの
		// 判断はクライアントの責務であり、サーバ側は 1 行も変更していない。
		const countryCode = getAddressCountryCode(location.address);

		// #1196 【仕様】ガード1: address が正規形式でない（`country:XX` トークンを持たない）。
		//
		// この address は表示用の文字列ではなく、推薦 API が地域ゲートの照合に使う機械可読な
		// トークン列である（詳細は lib/addressFormat.ts）。"大阪市" のような市区町村名単体を送ると
		// `region:大阪市` になってどのゲートにも当たらず、候補 0 件 → Claude フォールバックが
		// 常時発火する（本番で 1日 1,445件 / 204ユーザー）。呼ぶ前に止める。
		//
		// error レベルにする理由: 正規形式でない address は **自クライアントが壊れた値を作った**
		// ということで、設計上は起きてはならない。ユーザー操作では回復せずエンジニアの対応が
		// 必要なので ERROR。生成元（lib/addressFormat.ts の buildAddressFromGeocodedAddress）は
		// 修正済みなので、このログが出たら別の生成経路が壊れている。
		if (countryCode === null) {
			logFrontendEvent({
				event_name: "search_blocked_malformed_address",
				error_level: "error",
				payload: {
					address: location.address,
					locationQuery,
					latitude: location.location.latitude,
					longitude: location.location.longitude,
				},
			});
			showSnackbar(i18n.t("Search.errors.malformedAddress"));
			// #932 と同じ導線。手入力で選び直してもらうため地点入力へフォーカスを戻す
			locationInputRef.current?.focus();
			return;
		}

		// #1196 【仕様】ガード2: 国コードが JP 以外（= 本サービスが未対応の海外）。
		//
		// warn レベルにする理由: 海外からの利用は想定内であり、ダイアログで設計どおり案内できて
		// いる（= 回復済み）ので ERROR ではない。ただし「新しいビルドで海外アクセスがどれだけ
		// 来ているか」を可視化したいので、握り潰さず必ず記録する。
		if (countryCode !== SUPPORTED_COUNTRY_CODE) {
			// 既に告知が出ている間の連打は、ログもダイアログも積まない
			if (isUnsupportedRegionNoticeOpenRef.current) return;
			isUnsupportedRegionNoticeOpenRef.current = true;

			logFrontendEvent({
				event_name: "search_blocked_unsupported_country",
				error_level: "warn",
				payload: {
					country_code: countryCode,
					address: location.address,
					locationQuery,
					latitude: location.location.latitude,
					longitude: location.location.longitude,
				},
			});
			// #1196 【設計】選択肢の無い告知なので OK 単独のボタンにする（showCancel: false）。
			// 押しても閉じるだけで、検索は実行されない。
			void confirm({
				title: i18n.t("Search.unsupportedRegion.title"),
				message: i18n.t("Search.unsupportedRegion.message"),
				confirmLabel: i18n.t("Search.unsupportedRegion.confirm"),
				showCancel: false,
			})
				.finally(() => {
					// 閉じたら次の告知を許可する（地点を変えずに押し直したときは再度出したい）
					isUnsupportedRegionNoticeOpenRef.current = false;
				})
				// #1196 【設計】この catch は必須。DialogProvider は unmount 時に未解決の confirm を
				// **reject** する（「unmount 時の掃除」の effect）。`.finally` は理由をそのまま
				// 通すので、ここで受けないと画面遷移のたびに unhandled rejection になる。
				// ref の解放は `.finally` が済ませているため、ここは握り潰すだけでよい。
				.catch(() => undefined);
			return;
		}

		if (isSearchingRef.current) return; // 多重検索防止

		mediumImpact();
		isSearchingRef.current = true;

		const searchParams: SearchParams = {
			...location,
			timeSlot,
			scene,
			taste,
			coreIngredient,
			diningPace,
			distance,
			priceLevels,
			locationQuery, // #674 【仕様】検索画面で入力されたロケーション表示用文字列を渡す
		};

		logFrontendEvent({
			event_name: "search_started",
			error_level: "log",
			payload: searchParams,
		});

		// Navigate to cards screen with search parameters
		router.push({
			pathname: "/[locale]/(tabs)/search/dish-categories",
			params: {
				locale,
				searchParams: JSON.stringify(searchParams),
			},
		});

		setTimeout(() => {
			isSearchingRef.current = false;
		}, 1000);
	}, [
		location,
		timeSlot,
		scene,
		taste,
		coreIngredient,
		diningPace,
		distance,
		priceLevels,
		locationQuery,
		mediumImpact,
		logFrontendEvent,
		showSnackbar,
		confirm,
		locale,
	]);
	// Wrapper functions for haptic feedback
	const handleTimeSlotSelect = (slotId: SearchParams["timeSlot"]) => {
		lightImpact();
		setTimeSlot(slotId);
		// #1375 ここが «人が選んだ» の唯一の入口。以後この端末では時刻による自動選択をしない
		setTimeSlotTouched(true);
	};

	// #533 【仕様】scene を必須化（解除不可、レコメンドAPI必須化対応）
	const handleSceneSelect = (sceneId: SearchParams["scene"]) => {
		lightImpact();
		setScene(sceneId);
	};

	const handleFoodStyleSelect = (option: (typeof foodStyleOptions)[number]) => {
		lightImpact();
		if (option.featureType === "taste") {
			setTaste(taste === option.id ? undefined : option.id);
			setCoreIngredient(undefined);
			return;
		}
		setCoreIngredient(coreIngredient === option.id ? undefined : option.id);
		setTaste(undefined);
	};

	const handleDiningPaceSelect = (diningPaceId: SearchParams["diningPace"]) => {
		lightImpact();
		setDiningPace(diningPace === diningPaceId ? undefined : diningPaceId);
	};

	const handleAdvancedToggle = () => {
		lightImpact();
		setShowAdvancedFilters(!showAdvancedFilters);
	};

	// #973【設計】検索ボタンをdisabledにすると handleSearch 内のバリデーションスナックバーが
	// 発火しなくなるため、常にタップ可能にしたうえで見た目だけ「未充足」を伝える
	const isSearchReady = !!location && !!timeSlot && !!scene;

	// #1092 【設計】現在地の自動取得は下の「一度きり」ガードの内側から呼ばれるため、
	// 認証未確立で失敗するとその起動では現在地が二度と入らない。
	// トークン欠如で失敗したときだけ auth 解決後に 1 回取り直す責務をフックへ切り出している。
	const { requestAutoCurrentLocation } = useAutoCurrentLocation({
		getCurrentLocation,
		onResolved: useCallback((currentLocation: Omit<LocationDetailsResponse, "viewport">) => {
			// #1502 進行中の候補確認(details取得)があれば無効化する
			locationConfirmationRequestIdRef.current += 1;
			lastLocationPredictionRef.current = null;
			setLocation(currentLocation);
			setLocationQuery(i18n.t("Search.currentLocation"));
			setLocationConfirmationStatus("confirmed");
		}, []),
	});

	// ========== オンボーディング表示制御（#1486） ==========
	// #1486 §3【設計】既読の判定は旧チュートリアルと **同じキー** を読む
	//（features/onboarding/onboardingSeenStore.ts）。既存ユーザーには再表示しない
	const hasSeenOnboarding = useOnboardingSeen();
	// オンボーディングへ送るのは 1 度だけ（途中で離脱した人を送り返して閉じ込めない）
	const didPushOnboardingRef = useRef(false);
	// 現在地の自動取得も 1 度だけ
	const didRequestAutoLocationRef = useRef(false);
	// 画面がフォーカスされているかを判定（オンボーディングへ遷移している間は false になる）
	const isFocused = useIsFocused();

	const requestAutoCurrentLocationOnce = useCallback(() => {
		if (didRequestAutoLocationRef.current) return;
		// #1736 オンボーディングで «許可しない» と答えた直後に、説明の無い OS ダイアログを
		// 続けて出さない（Android は canAskAgain が残っている限りもう一度出す）。
		// ユーザー操作起点の «現在地» ボタンは従来どおり要求する
		if (wasDeniedInOnboarding("location")) {
			didRequestAutoLocationRef.current = true;
			return;
		}
		// #1375 復元した地点を現在地で踏み潰さない。人が «渋谷» を選んで検索したあと
		// 戻ってきたら «現在地» に置き換わっている、という取り消しになるため
		if (restoredConditionsRef.current?.location) {
			didRequestAutoLocationRef.current = true;
			return;
		}
		didRequestAutoLocationRef.current = true;
		requestAutoCurrentLocation();
	}, [requestAutoCurrentLocation]);

	useEffect(() => {
		if (!isFocused) return;
		// null は「まだ読み込んでいない」。既読とも未読とも判定してはいけない
		if (hasSeenOnboarding === null) return;

		if (!isJapanese) {
			// #642 【設計】対応言語以外ではオンボーディングを表示しない
			requestAutoCurrentLocationOnce();
			return;
		}

		if (hasSeenOnboarding) {
			// #1486 【設計】ここは «初回導線を終えて戻ってきた» 直後にも通る。
			// オンボーディングの中で位置情報を許可してもらっているので、その足で現在地を入れる
			//（旧チュートリアルが最終ページの「現在地を利用する」で行っていたことの引き継ぎ）
			requestAutoCurrentLocationOnce();
			return;
		}

		if (didPushOnboardingRef.current) return;
		didPushOnboardingRef.current = true;

		logFrontendEvent({
			event_name: "onboarding_auto_opened",
			error_level: "log",
			payload: { opened_reason: "auto" },
		});
		router.push(onboardingIndexPath(locale) as ExternalPathString);
	}, [isFocused, hasSeenOnboarding, isJapanese, locale, logFrontendEvent, requestAutoCurrentLocationOnce]);

	// #1486 §3【設計】`？` からは «既読状態に関係なく» オンボーディングを開く。
	// ただし 3 ステップだけを見せて戻す（`mode=manual`）。ログイン・権限・Welcome は
	// 初回導線のためのもので、既に本体を使っている人へ再度通す意味が無い
	const handleOpenOnboarding = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "onboarding_opened",
			error_level: "log",
			payload: { opened_reason: "manual" },
		});
		router.push(onboardingIndexPath(locale, "manual") as ExternalPathString);
	};

	// #1087 【設計】E2E(Detox) ビルドに限り、先読み画像が実際に何枚ロードできたかを数えて
	// 画面上の `<Text testID="search-preload-probe">` へ出す（通常ビルドでは metro の resolver が
	// noop 実装へ差し替えるため、props も要素も一切増えない）。詳細は lib/e2e/preloadProbe.tsx
	const preloadProbe = useE2EPreloadProbe(PRELOAD_IMAGES.length);

	return (
		<SafeAreaView style={styles.container} edges={["top"]}>
			{/* Header */}
			<View style={styles.header}>
				{/* #1031 【設計】Detox から表示確認できるよう testID を追加 */}
				{/* #1486 【バグ】`numberOfLines` / `ellipsizeMode` を外さないこと。
				    詳細は styles.headerTitle のコメントを参照（`？` が右へはみ出す） */}
				<Text
					testID="search-header-title"
					style={styles.headerTitle}
					numberOfLines={1}
					ellipsizeMode="tail"
					// OS の文字サイズ設定を «無視» はしないが、青天井にもしない。
					// ヘッダーは 1 行に固定してあるので、上げすぎると本文がほとんど «…» になる
					maxFontSizeMultiplier={1.4}>
					{i18n.t("Search.headerTitle")}
				</Text>
				{/* #1486 §3【設計】ヘルプアイコンからオンボーディングを再表示 */}
				{isJapanese && (
					<TouchableOpacity
						style={styles.helpButton}
						onPress={handleOpenOnboarding}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Search.accessibility.showTutorial")}
						testID="search-help-button">
						<HelpCircle size={24} color={colors.textSecondary} />
					</TouchableOpacity>
				)}
			</View>

			{/* #1027 【設計】Detox の `whileElement(...).scroll()` でスクロール対象を指定できるよう testID を追加。
			    これが無いと E2E 側は「スクロール領域内の小さな要素を swipe する」代替手段しか取れず、
			    1 回のスワイプ量が要素の高さに制限されて画面下部の要素へ到達できない（run 30432596949 で実測） */}
			<ScrollView
				testID="search-scroll-view"
				style={styles.scrollView}
				/*
				#1629 Android はキーボードのぶんを自分で空ける。
				Android 15 以降は edge-to-edge が強制で `adjustResize` が窓を縮めなくなったため、
				«OS が縮めてくれる» という前提が成り立たない（`hooks/useKeyboardInset.ts`）。
				*/
				contentContainerStyle={[
					styles.scrollContent,
					Platform.OS === "android" && keyboardInset > 0 ? { paddingBottom: keyboardInset } : null,
				]}
				keyboardShouldPersistTaps="always"
				// ⚠️ iOS ではキーボードが画面に «覆いかぶさる»（Android のようにウィンドウが縮まない）。
				// このフォームは最下部が詳細条件トグル + 100px の余白 + 検索 FAB で終わるため、
				// キーボードが開いている間は **どこまでスクロールしても詳細条件トグルが画面下半分から出られず**、
				// 触ることも読むこともできない状態になる。
				// 地点入力は現在地の取得に失敗すると自動でフォーカスを取る（#932）ので、
				// 「一度も自分でタップしていないのに詳細条件が押せない」という詰みが実際に起きる。
				// ドラッグで閉じられるようにして脱出路を用意する（iOS の Detox が
				// `threshold (75)` で 4 回連続落ちて判明。Android は adjustResize のため無症状だった）。
				// `keyboardShouldPersistTaps="always"` とは併用可能で、サジェストのタップは従来どおり通る。
				//
				// 補足: `LocationAutocomplete` のサジェスト / 最近使った場所は `isFocused` で出し分けているため、
				// キーボードを閉じるとパネルも閉じる。ネイティブで閉じるのは **このフォームをドラッグしたとき**だけで、
				// パネル自身は内側に own ScrollView を持っている（keyboardShouldPersistTaps="handled"）ので、
				// 候補一覧をスクロールして読む操作では閉じない。
				//
				// ⚠️ **iOS 限定にすること。** react-native-web の ScrollView は `on-drag` を
				// 「ドラッグ開始時」ではなく **scroll イベントのたびに** `dismissKeyboard()` する実装で
				// （react-native-web/dist/exports/ScrollView/index.js の `_handleScroll`）、
				// プログラム的なスクロールやレイアウト変化でも入力欄が blur される。
				// その結果 web では地名を打ってもサジェストが出た瞬間に消える。
				// 実際に e2e-web の logout.spec.ts が 3 回リトライして落ちた（run 31677888461）。
				// Android はキーボードでウィンドウが縮む（adjustResize）ため、そもそもこの詰みが起きない。
				keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : undefined}
				showsVerticalScrollIndicator={false}>
				{/* Location Input */}
				<View style={styles.section}>
					<SectionHeader
						icon={<MapPin size={20} color={colors.brand} />}
						title={i18n.t("Search.sections.location")}
						required
					/>
					<View style={styles.locationSection}>
						<LocationAutocomplete
							ref={locationInputRef}
							value={locationQuery}
							onChangeText={handleLocationQueryChange}
							onSelectSuggestion={handleLocationSelect}
							onClear={handleLocationClear}
							placeholder={i18n.t("Search.placeholders.enterLocation")}
							autoClearOnFocus={locationQuery === i18n.t("Search.currentLocation")}
							recentLocations={recentLocations}
							onSelectRecentLocation={handleSelectRecentLocation}
							onClearRecentLocations={recentLocations.length > 0 ? clearRecentLocations : undefined}
							confirmationStatus={locationConfirmationStatus}
							onRetryConfirmation={handleRetryLocationConfirmation}
							renderInputRight={
								<TouchableOpacity
									style={styles.currentLocationButton}
									onPress={handleUseCurrentLocation}
									hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Search.accessibility.useCurrentLocation")}
									testID="search-current-location-button">
									<Navigation size={20} color={colors.textStrong} />
								</TouchableOpacity>
							}
							testID="search-location-autocomplete"
						/>
					</View>
				</View>

				{/* #667 【設計】Time of Day - カード無し、画像グリッド表示（4列1行） */}
				<View style={styles.section}>
					<SectionHeader
						icon={<SunMoon size={20} color={colors.brand} />}
						title={i18n.t("Search.sections.time")}
						required
					/>
					<View
						style={styles.gridContainer}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.time")}>
						{timeSlots.map((slot) => (
							<SelectableGridItem
								key={slot.id}
								testID={`search-time-slot-${slot.id}`}
								selected={timeSlot === slot.id}
								onPress={() => handleTimeSlotSelect(slot.id)}
								image={slot.image}
								label={i18n.t(slot.label)}
								itemWidth={itemWidth}
							/>
						))}
					</View>
				</View>

				{/* #667 【設計】Scene - カード無し、画像グリッド表示（4列2行） */}
				<View style={styles.section}>
					<SectionHeader
						icon={<Users size={20} color={colors.brand} />}
						title={i18n.t("Search.sections.scene")}
						required
					/>
					<View
						style={styles.gridContainer}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.scene")}>
						{sceneOptions.map((option) => (
							<SelectableGridItem
								key={option.id}
								testID={`search-scene-${option.id}`}
								selected={scene === option.id}
								onPress={() => handleSceneSelect(option.id)}
								image={option.image}
								label={i18n.t(option.label)}
								itemWidth={itemWidth}
							/>
						))}
					</View>
				</View>

				{/* Price Levels */}
				<View style={styles.section}>
					<SectionHeader
						icon={<DollarSign size={20} color={colors.brand} />}
						title={i18n.t("Search.sections.budget")}
					/>
					<View style={styles.sliderSection}>
						<PriceLevelsMultiSelect
							selectedPriceLevels={priceLevels}
							onPriceLevelsChange={setPriceLevels}
							customStyles={{ chipGrid: styles.chipGrid }}
							groupAccessibilityLabel={i18n.t("Search.sections.budget")}
						/>
					</View>
				</View>

				{/* Dining Pace */}
				<View style={styles.section}>
					<SectionHeader icon={<Timer size={20} color={colors.brand} />} title={i18n.t("Search.sections.diningPace")} />
					<View
						style={styles.chipGrid}
						accessibilityRole="radiogroup"
						accessibilityLabel={i18n.t("Search.sections.diningPace")}>
						{diningPaceOptions.map((option) => (
							<SelectableChip
								key={option.id}
								role="radio"
								selected={diningPace === option.id}
								label={i18n.t(option.label)}
								icon={option.icon}
								onPress={() => handleDiningPaceSelect(option.id)}
								testID={`search-dining-pace-${option.id}`}
							/>
						))}
					</View>
				</View>

				{/* Advanced Filters Toggle */}
				{!showAdvancedFilters && (
					<TouchableOpacity
						testID="search-advanced-toggle"
						style={styles.advancedToggle}
						onPress={handleAdvancedToggle}>
						{showAdvancedFilters ? (
							<ChevronUp size={20} color={colors.brand} />
						) : (
							<Plus size={20} color={colors.brand} />
						)}
						<Text style={styles.advancedToggleText}>
							{showAdvancedFilters ? i18n.t("Search.advancedToggle.close") : i18n.t("Search.advancedToggle.open")}
						</Text>
					</TouchableOpacity>
				)}

				{/* Advanced Filters Section */}
				{showAdvancedFilters && (
					<>
						{/* Distance */}
						<View style={styles.section}>
							<SectionHeader
								icon={<Ruler size={20} color={colors.brand} />}
								title={i18n.t("Search.sections.distance")}
							/>
							<View style={styles.sliderSection}>
								{/* #987 【設計】距離値・おすすめ移動時間・詳細開閉を一つのコンパクトな操作領域に集約 */}
								<DistanceSlider distance={distance} setDistance={setDistance} />
							</View>
						</View>

						{/* Food Style */}
						<View style={styles.section}>
							<SectionHeader
								icon={<ChefHat size={20} color={colors.brand} />}
								title={i18n.t("Search.sections.foodStyle")}
							/>
							<View
								style={styles.chipGrid}
								accessibilityRole="radiogroup"
								accessibilityLabel={i18n.t("Search.sections.foodStyle")}>
								{foodStyleOptions.map((option) => {
									const isSelected =
										option.featureType === "taste" ? taste === option.id : coreIngredient === option.id;
									return (
										<SelectableChip
											key={`${option.featureType}:${option.id}`}
											role="radio"
											selected={isSelected}
											label={i18n.t(option.label)}
											icon={option.icon}
											onPress={() => handleFoodStyleSelect(option)}
											testID={`search-food-style-${option.featureType}-${option.id}`}
										/>
									);
								})}
							</View>
						</View>

						{/* Restrictions */}
						{
							// #541 にて廃止
							// (<View style={styles.section}>
							// 	<View style={styles.sectionHeader}>
							// 		<Text style={styles.sectionTitle}>{i18n.t("Search.sections.restrictions")}</Text>
							// 	</View>
							// 	<View style={styles.restrictionsContainer}>
							// 		{restrictionOptions.map((option) => (
							// 			<TouchableOpacity
							// 				key={option.id}
							// 				style={[styles.restrictionChip, restrictions.includes(option.id) && styles.selectedRestrictionChip]}
							// 				onPress={() => toggleRestriction(option.id)}>
							// 				<Text style={styles.chipEmoji}>{option.icon}</Text>
							// 				<Text
							// 					style={[
							// 						styles.restrictionChipText,
							// 						restrictions.includes(option.id) && styles.selectedRestrictionChipText,
							// 					]}>
							// 					{i18n.t(option.label)}
							// 				</Text>
							// 			</TouchableOpacity>
							// 		))}
							// 	</View>
							// </View>)
						}
					</>
				)}
			</ScrollView>

			{/* Search FAB */}
			{/* #973【設計】コンテナ背景は完全透明にし、ボタンの裏に隠れがちな価格帯セクションに気づけるようにする。
			    ボタン以外の透明部分はタッチを透過させ、下のスクロール操作を妨げない。
			    ボタン自体は searchFab に白背景を持たせて視認性を確保しつつ、
			    未充足時は disabled にせず色をグレーに落とすことで、押下時の
			    バリデーションスナックバー（handleSearch 内）が必ず届くようにする */}
			{/* #989 【修正】絶対配置の全幅コンテナがボタン以外の透明領域でもクリックを奪い、
			    この帯域に重なるフォーム要素(距離スライダー等)がマウス操作不能になっていたため、
			    コンテナ自体はヒット対象から外し子のボタンだけが反応するようにする */}
			<View style={styles.searchFabContainer} pointerEvents="box-none">
				<PrimaryButton
					testID="search-submit-button"
					label={i18n.t("Search.searchButton")}
					onPress={handleSearch}
					colors={
						isSearchReady
							? [colors.ctaBackground, colors.ctaBackground]
							: [colors.ctaBackgroundDisabled, colors.ctaBackgroundDisabled]
					}
					labelStyle={{ color: isSearchReady ? colors.ctaLabel : colors.ctaLabelDisabled }}
					shadowColor={FixedColors.ctaShadow}
					icon={<Search size={20} color={isSearchReady ? colors.ctaLabel : colors.ctaLabelDisabled} />}
					style={styles.searchFab}
				/>
			</View>

			{/* #642 【設計】オフスクリーンでオンボーディング画像を一度描画して decode */}
			{/* #934 【修正】decode専用で内容を持たないため aria-hidden で支援技術から隠す(axe: image-alt 対策) */}
			{/* #1087 【修正】0×0 だと native は 1 枚もロードしない。expo-image のネイティブ実装は
			    ビューの bounds が 0 のときロード要求そのものを発行しないため、先読みは導入時(#656)から
			    native では一度も効いていなかった。
			    - iOS: ImageView.reload() は `guard let source = bestSource else { return }` で抜ける。
			      bestSource は ImageUtils.getBestSource(from:forSize:) 経由で、
			      `if size.width <= 0 || size.height <= 0 { return nil }` により無条件に nil になる
			      (プレースホルダと違い本体 source にはフォールバックが無い)。
			    - Android: ExpoImageViewWrapper.cleanIfNeeded() が `if (width == 0 || height == 0 ...)`
			      で recycleView() して return し、Glide のリクエストを発行しない。
			    - web だけはサイズに関係なく <img src> を DOM へ出すため効いていた(#1085 が web で
			      「差なし」、#1086 の E2E が緑だったのはこのため)。
			    そこで親・子とも非ゼロサイズ(1x1)を明示してロードを発行させる。見た目に出ないよう
			    opacity: 0 を足し、pointerEvents="none" でタッチも奪わない。
			    サイズが 0 に戻る再発は features/search/searchScreenPreload.test.tsx で検知する。 */}
			{/* #1087 【設計】onLoad / onError は E2E ビルドでのみ実体を持つ（通常ビルドでは空オブジェクト）。
			    上記の jest テストは「style が非ゼロか」という構造しか見ないため、expo-image 側の都合で
			    実際にはロードされなくなった場合（1×1 では足りなくなる / opacity:0 で早期 return される 等）を
			    見逃す。それを native で捕まえるための計測点で、
			    e2e-mobile/tests/search/preload-images.test.ts が実ロード枚数を検証する */}
			<View
				style={{ width: 1, height: 1, position: "absolute", overflow: "hidden", opacity: 0 }}
				pointerEvents="none"
				aria-hidden>
				{PRELOAD_IMAGES.map((src, i) => (
					<Image key={i} source={src} style={{ width: 1, height: 1 }} {...preloadProbe.imageProps(i)} />
				))}
			</View>
			{preloadProbe.element}
		</SafeAreaView>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.background,
		},
		scrollView: {
			flex: 1,
		},
		scrollContent: {
			paddingBottom: 100, // moved here so it affects ScrollView content
			gap: 12,
		},
		header: {
			paddingHorizontal: 24,
			paddingTop: 20,
			paddingBottom: 20,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
		},
		helpButton: {
			paddingHorizontal: 8,
			// #1272 タイトルが伸びても «絶対に» 縮まない。ヘッダーは space-between なので、
			// これが無いと限られた幅の奪い合いでボタン側が潰されうる
			flexShrink: 0,
			// #1486 アイコン(24) + 左右の padding(8+8) 分の幅を «先に» 確保する。
			// 幅を内容任せにすると、レイアウトの確定順によってはタイトルが先に場所を取り切る
			width: 40,
			alignItems: "center",
			justifyContent: "center",
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
			letterSpacing: -0.5,
			// ⚠️ **`flex: 1` を外さないこと。** 無いと Text が自然幅を取り、日本語の長いタイトル
			// （"どんな料理を探しましょう？🍽"）が **ヘルプボタンを画面外へ押し出す**。
			// 320dp 幅の Android エミュレータで実測: タイトルが 2 行に折り返し、
			// 「?」ボタンが右端で見切れて押せない状態になっていた（run 31698138582 の
			// 失敗時スクリーンショットで確認。Detox が 75% 可視を満たせず落ちたのは正しい検出だった）。
			// 小さめの実機（幅の狭い端末 / 大きい文字サイズ設定）でも同じ詰みが起きる
			flex: 1,
			// #1486 【バグ】`flex: 1` **だけでは足りない**（実機の iPhone で `？` が右へはみ出す報告）。
			//
			// `flex: 1` は `flexBasis: 0` を含むので «配分» は正しく行われるが、Yoga は
			// 折り返し可能な Text を「与えられた幅で測って、収まらなければ実測幅を返す」形で測る。
			// 日本語のタイトルは空白が無く、端末の文字サイズ設定（Dynamic Type）を上げると
			// 1 行が配分された幅を超え、**測定値がそのまま行ボックスの幅**になる。
			// 行が伸びた分だけ right 側の兄弟が押し出され、`？` が画面の外へ出る。
			// 画面幅が狭いほど、また文字サイズ設定が大きいほど起きやすい。
			//
			// 料理提案画面（`app/[locale]/(tabs)/search/dish-categories.tsx` → `components/ScreenHeader.tsx`）で
			// 同じ症状が出ていないのは、あちらのタイトルが `numberOfLines={1}` + `ellipsizeMode="tail"` で
			// **1 行に固定されている**ため。折り返しが起きない Text は与えられた幅で必ず打ち切られ、
			// 測定値が配分幅を超えない。こちらも同じ形へ揃えてある（JSX 側を参照）。
			//
			// `minWidth: 0` は web（react-native-web）向け。CSS の flex アイテムは既定で
			// `min-width: auto`（＝内容の最小幅より縮まない）なので、これが無いと同じ症状が web で残る。
			minWidth: 0,
		},
		// #667 【設計】カード無しセクションのスタイル
		section: {
			paddingHorizontal: HORIZONTAL_PADDING,
			marginBottom: 24,
		},
		sectionHeader: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 16,
		},
		sectionTitle: {
			fontSize: 16,
			fontWeight: "700",
			color: c.textPrimary,
			marginLeft: 8,
			flex: 1,
		},
		requiredBadge: {
			backgroundColor: c.dangerTint,
			paddingHorizontal: 8,
			paddingVertical: 4,
			borderRadius: 12,
		},
		requiredText: {
			fontSize: 10,
			fontWeight: "600",
			color: c.danger,
		},
		locationSection: {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: 12,
		},
		currentLocationButton: {
			padding: 16,
			borderLeftWidth: 0.5,
			borderLeftColor: c.border,
		},
		// #667 【設計】画像グリッドコンテナ（4列、flexWrap）
		gridContainer: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: ITEM_GAP,
		},
		// #667 【設計】ムード用の横並びコンテナ
		moodContainer: {
			flexDirection: "row",
			justifyContent: "space-around",
			alignItems: "center",
			paddingVertical: 16,
		},
		// #667 【設計】ムード個別アイテム（円+ラベル縦並び）
		moodItem: {
			flex: 1,
			alignItems: "center",
			gap: 8,
		},
		// #667 【設計】ムードの円形アイコン
		moodCircle: {
			backgroundColor: c.border,
			borderRadius: 100, // 完全な円
		},
		selectedMoodCircle: {
			backgroundColor: c.textStrong,
		},
		// #667 【設計】ムードのラベル
		moodLabel: {
			fontSize: 13,
			color: c.textStrong,
			fontWeight: "500",
			textAlign: "center",
		},
		selectedMoodLabel: {
			fontWeight: "600",
		},
		advancedToggle: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.brandTint,
			marginHorizontal: 24,
			paddingVertical: 16,
			paddingHorizontal: 20,
			borderRadius: 16,
		},
		advancedToggleText: {
			fontSize: 15,
			color: c.brand,
			fontWeight: "600",
			marginLeft: 12,
		},
		chipGrid: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: 12,
		},
		sliderSection: {
			width: "100%",
		},
		searchFabContainer: {
			position: "absolute",
			bottom: 0,
			paddingTop: 12,
			paddingBottom: 32,
			paddingHorizontal: HORIZONTAL_PADDING,
			width: "100%",
			justifyContent: "center",
			flexDirection: "row",
			alignItems: "center",
		},
		searchFab: {
			width: "100%",
			// #973【設計】コンテナ全体を透明にした分、ボタンの矩形部分だけ白背景を持たせて
			// 未充足時のグレー表示も含め視認性を確保する(価格帯セクションの見通しは維持)
			backgroundColor: c.ctaSurface,
			borderRadius: 8,
		},
		restrictionsContainer: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: 12,
		},
		restrictionChip: {
			flexDirection: "row",
			alignItems: "center",
			backgroundColor: c.surfaceMuted,
			paddingHorizontal: 12,
			paddingVertical: 8,
			borderRadius: 20,
			marginBottom: 8,
		},
		selectedRestrictionChip: {
			backgroundColor: c.dangerStrong,
		},
		restrictionChipText: {
			fontSize: 11,
			color: c.textSecondary,
			fontWeight: "500",
			marginLeft: 8,
			marginRight: 8,
		},
		selectedRestrictionChipText: {
			// #1509 `#FFF` と `#FFFFFF` は同一色。赤いチップの上の文字はテーマ非追従
			color: FixedColors.onFilled,
			fontWeight: "700",
		},
	});
