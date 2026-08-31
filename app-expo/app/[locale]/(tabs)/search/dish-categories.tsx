import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { MapPin, SunMoon, Users, ChefHat, RefreshCw, DollarSign, Timer, CircleHelp } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Carousel } from "react-native-reanimated-carousel";
import { DishCategoryRecommendation, SearchParams } from "@/types/search";
import { useDishCategorySearch } from "@/features/dishCategories/hooks/useDishCategorySearch";
import { useBlockDishCategory } from "@/features/dishCategories/hooks/useBlockDishCategory";
import { DishCategoryCard, DISH_CATEGORY_CARD_CTA_OVERHANG, type DishCategoryDeepDiveOption } from "@/features/dishCategories/components/DishCategoryCard";
import { DishCategoryCardExpandTransition, type CardRect } from "@/features/dishCategories/components/DishCategoryCardExpandTransition";
import { DishCategoryThumbnail } from "@/features/dishCategories/components/DishCategoryThumbnail";
import { useDishCategoryImageResources } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import { DishCategoriesLoading } from "@/features/dishCategories/components/DishCategoriesLoading";
import { DishCategoriesError } from "@/features/dishCategories/components/DishCategoriesError";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useDishCategoryCardSize } from "@/features/dishCategories/hooks/useDishCategoryCardSize";
import { useContentWidth } from "@/hooks/useContentWidth";
import {
	budgetIntentToPriceLevel,
	coreIngredientOptions,
	coreIngredientOptionsById,
	deriveBudgetIntentFromPriceLevels,
	diningPaceOptions,
	diningPaceOptionsById,
	foodStyleOptions,
	priceLevelOptions,
	sceneOptionsById,
	tasteOptions,
	tasteOptionsById,
	timeSlotsById,
} from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useCreateDishCategoryGroupVote } from "@/features/dishCategoryGroupVotes/hooks/useCreateDishCategoryGroupVote";
import { useDishCategoriesTutorial } from "@/features/dishCategories/hooks/useDishCategoriesTutorial";
import { DishCategoriesSpotlightTutorial } from "@/features/dishCategories/components/DishCategoriesSpotlightTutorial";
import type { DishCategoriesTutorialTargetRefs } from "@/features/tutorial/types/spotlight";
import type { CreateDishCategoryGroupVoteResponse } from "@shared/api/v1/res";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

const DEEP_DIVE_SCORE_THRESHOLD = 0.85;

// ヘッダーアイコンは見た目を小さく保ちつつ、タップ領域だけ44pt相当に広げる。
const HEADER_ACTION_HIT_SLOP = { top: 12, right: 12, bottom: 12, left: 12 };

const BUDGET_INTENT_ORDER = priceLevelOptions.map((option) => option.budgetIntent);
const DINING_PACE_ORDER = diningPaceOptions.map((option) => option.id);
const FOOD_STYLE_ORDER = foodStyleOptions.map((option) => option.id);
const ALLOWED_DEEP_DIVE_KEYS = {
	budget_intent: new Set(priceLevelOptions.map((option) => option.budgetIntent)),
	dining_pace: new Set(diningPaceOptions.map((option) => option.id)),
	taste: new Set(tasteOptions.map((option) => option.id)),
	core_ingredient: new Set(coreIngredientOptions.map((option) => option.id)),
} as const;

const getOrderIndex = (order: readonly string[], key: string) => {
	const index = order.indexOf(key);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export default function DishCategoriesScreen() {
	// #1016 【設計】カード操作が重いという申告のある画面のため、Firebase Performance Monitoringの画面トレースを計装する。
	// #1553 【互換性】トレース名は Firebase Performance の既存系列を分断しないため旧名 "Topics" を維持する
	// （event_name と同じ扱い。改名するかはオーナー判断）
	useScreenTrace("Topics");
	// #1629 オーナー実機報告「料理提案画面自体がダークモードに対応してない」。
	// 地・条件チップ・ヘッダーアイコンがライト固定の直書きだったのでテーマのトークンへ移した
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { locale } = useLocale();
	const { searchParams, pinnedDishCategory: pinnedDishCategoryParam } = useLocalSearchParams<{
		searchParams: string;
		pinnedDishCategory?: string;
	}>();
	const params = useMemo(() => {
		if (searchParams) {
			try {
				return JSON.parse(searchParams) as SearchParams;
			} catch {
				return null;
			}
		}
		return null;
	}, [searchParams]);
	const pinnedDishCategory = useMemo(() => {
		if (!pinnedDishCategoryParam) return null;
		try {
			return JSON.parse(pinnedDishCategoryParam) as DishCategoryRecommendation;
		} catch {
			return null;
		}
	}, [pinnedDishCategoryParam]);
	const { logFrontendEvent } = useLogger();
	const [currentIndex, setCurrentIndex] = useState(0);
	const [loadedSearchSessionKey, setLoadedSearchSessionKey] = useState<string | null>(null);
	const [carouselAvailableHeight, setCarouselAvailableHeight] = useState(0);
	const [isSelectingDishCategory, setIsSelectingDishCategory] = useState(false);
	// #1484 【設計】押されたカード画像がその場からフルスクリーンへ広がるアニメーションの対象。
	// 画面遷移は広がり切ってから行うため、遷移処理そのものは ref に積んでおく。
	const [expandingCard, setExpandingCard] = useState<{
		imageUrl: string;
		originRect: CardRect;
		targetRect: CardRect;
	} | null>(null);
	const pendingNavigateRef = useRef<(() => void) | null>(null);
	/**
	 * #1484 【設計】web は CenteredAppShell により画面中央の狭いカラムへ収まっており、
	 * react-native-web は全 View に既定で position:relative を当てるため、この overlay の
	 * position:absolute は window ではなく直近の親（この画面のルート View）基準で解決される。
	 * originRect（measureInWindow = window絶対座標）をそのまま渡すと、そのズレの分だけ
	 * 開始位置がカードから外れ、広がる先も window 全体（カラム外の余白まで）になってしまう。
	 * このルート View 自身を計測し、相対座標へ変換した上で渡す。
	 */
	const screenContainerRef = useRef<View>(null);
	const carouselRef = useRef<any>(null);
	// React stateの反映前に連打された押下も防ぐため、同期的に参照できるガードを併用する。
	const isSelectingDishCategoryRef = useRef(false);
	// #907 【設計】サムネイルによるプログラム移動だけを識別し、スワイプ分析へ混在させない。
	const thumbnailNavigationTargetRef = useRef<number | null>(null);
	const createdGroupVoteRef = useRef<CreateDishCategoryGroupVoteResponse | null>(null);
	/**
	 * #1205 【修正】友達投票ボタンの連打を同期的に止めるガード。
	 *
	 * ボタンは `isCreating`(useState) で `disabled` になるが、state が画面へ反映される前の
	 * 2 発目は素通りする。素通りすると作成 API が二重に走るうえ、作成済み（`createdGroupVoteRef`）の
	 * 再訪時には **同期的に `router.push` が 2 回**走って結果画面が 2 枚積み上がる。
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続押下でもレースしない
	 *（この画面の `isSelectingDishCategoryRef` と同じ方式）。
	 *
	 * 解除は「失敗時は即時（catch）」「遷移した場合は結果画面から戻った時（useFocusEffect）」の 2 箇所。
	 * 成功後にその場で解除すると、遷移アニメーション中の押下で結果画面が二重に開きうる。
	 */
	const isOpeningGroupVoteRef = useRef(false);
	// #907 【設計】描画ライフサイクルと閲覧実績を分離し、検索セッション内のdishCategory単位で重複を防ぐ。
	const impressedDishCategoryIdsRef = useRef<Set<string>>(new Set());
	/**
	 * #927 【設計】スポットライトは「画面上に見えている実体」を計測する。
	 *
	 * Carousel内の4つはアクティブカードだけに渡し、headerのgroupVoteは常に同じViewを参照する。
	 * サムネイルは仕様上の説明対象外なのでref自体を用意しない。
	 */
	const swipeAreaTutorialRef = useRef<View>(null);
	const selectCtaTutorialRef = useRef<View>(null);
	const deepDiveTutorialRef = useRef<View>(null);
	const dishCategoryActionsTutorialRef = useRef<View>(null);
	const groupVoteTutorialRef = useRef<View>(null);
	const tutorialTargetRefs = useMemo<DishCategoriesTutorialTargetRefs>(
		() => ({
			swipeArea: swipeAreaTutorialRef,
			selectCta: selectCtaTutorialRef,
			deepDive: deepDiveTutorialRef,
			dishCategoryActions: dishCategoryActionsTutorialRef,
			groupVote: groupVoteTutorialRef,
		}),
		[],
	);
	const { selectionChanged } = useHaptics();

	// 結果画面から戻った時は再選択できるようにし、遷移中だけ連打を抑止する。
	// #1205 友達投票の同期ガードも同じ理由でここで解除する（投票結果画面から戻ったら再度開けること）。
	useFocusEffect(
		useCallback(() => {
			isSelectingDishCategoryRef.current = false;
			setIsSelectingDishCategory(false);
			isOpeningGroupVoteRef.current = false;
			// #1484 結果画面から戻ってきた時点で、広がりきったままのオーバーレイを消す。
			pendingNavigateRef.current = null;
			setExpandingCard(null);
		}, []),
	);

	/** #1484 拡大アニメーションが完了した瞬間に呼ばれ、予約しておいた画面遷移を実行する。 */
	const handleExpandComplete = useCallback(() => {
		const navigate = pendingNavigateRef.current;
		pendingNavigateRef.current = null;
		navigate?.();
	}, []);

	const { dishCategories, isLoading, error, searchDishCategories, refillDishCategories, hideDishCategory, unhideDishCategory, createDishItemsPromise } =
		useDishCategorySearch();
	const { showSnackbar } = useSnackbar();
	const { showDialog } = useDialog();
	/**
	 * #1499 【設計】取得失敗時の「その場で再試行」用の状態。
	 *
	 * `useDishCategorySearch` の `isLoading`/`error` は初回取得・再試行・リフィルで共有されており、
	 * 再試行を開始すると即座に `error` が null に戻る（`searchDishCategories` 冒頭の `setError(null)`）。
	 * DishCategoriesError の文言をその瞬間に失わせないよう、直近のエラーだけ別途保持しておく。
	 * 二重発火の防止は他の操作（isSelectingDishCategoryRef 等）と同じ同期 ref ガード。
	 */
	const isRetryingDishCategoriesRef = useRef(false);
	const [isRetryingDishCategories, setIsRetryingDishCategories] = useState(false);
	const [displayError, setDisplayError] = useState<string | null>(null);
	useEffect(() => {
		if (error) setDisplayError(error);
	}, [error]);
	const { handleBlockCard } = useBlockDishCategory(hideDishCategory, unhideDishCategory, showSnackbar);
	const { createGroupVote, isCreating } = useCreateDishCategoryGroupVote();
	// #958 【修正】CARD_WIDTH/CARD_MAX_HEIGHT/SCREEN_WIDTH(window幅固定、中央カラム幅と不一致)の
	// 代わりに useContentWidth ベースの値を使う
	// #1212 【修正】候補カルーセルは画面幅いっぱいに広げたい(左右の余白を無くす)ため fullBleed を指定する。
	const { cardWidth, cardMaxHeight } = useDishCategoryCardSize({ fullBleed: true });
	const contentWidth = useContentWidth();
	// #907 【設計】Carouselのmount条件とimpressionの準備条件で同じ高さを参照する。
	const cardHeight = useMemo(() => {
		if (carouselAvailableHeight <= 0) return 0;
		const heightWithMargin = carouselAvailableHeight - DISH_CATEGORY_CARD_CTA_OVERHANG;
		return Math.min(heightWithMargin, cardMaxHeight);
	}, [carouselAvailableHeight, cardMaxHeight]);

	useEffect(() => {
		const searchSessionKey = searchParams ?? "";
		// #907 【仕様】検索開始時に閲覧記録を無効化し、旧dishCategoriesを新しい検索セッションへ混在させない。
		setLoadedSearchSessionKey(null);
		impressedDishCategoryIdsRef.current.clear();
		thumbnailNavigationTargetRef.current = null;
		setCurrentIndex(0);
		if (carouselRef.current) {
			carouselRef.current.scrollTo({ index: 0, animated: false });
		}

		if (params) {
			searchDishCategories(params, { pinnedDishCategory })
				.then(() => {
					// #907 【設計】完了した検索キーを保持し、取得中に残る旧dishCategoriesのimpression送信を抑止する。
					setLoadedSearchSessionKey(searchSessionKey);
				})
				.catch(() => {
					// useDishCategorySearch は再試行と状態管理を担当し、画面側が最終失敗をSnackbarで可視化する。
					showSnackbar(i18n.t("DishCategories.errors.fetchFailed"));
				});
		} else {
			showSnackbar(i18n.t("DishCategories.errors.invalidSearchParams"));
			router.back();
		}
	// `router` は expo-router からの module import で identity が変わらないため依存に含めない
	}, [params, pinnedDishCategory, searchParams, searchDishCategories, showSnackbar]);

	const handleViewDetails = useCallback(
		(dishCategory: DishCategoryRecommendation, originRect?: CardRect) => {
			// #633 【Blocker】params が undefined の場合は早期 return（クラッシュ防止）
			if (!params?.location) {
				showSnackbar(i18n.t("DishCategories.errors.invalidSearchParams"));
				return;
			}
			if (isSelectingDishCategoryRef.current) return;
			isSelectingDishCategoryRef.current = true;
			setIsSelectingDishCategory(true);

			// #633 【設計】SavedDishCategoriesTab と同じパターンで entriesKey 駆動のオンデマンド取得
			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();

			// #633 【設計】entriesKey を生成（検索条件から一意のキーを作成）
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: dishCategory.categoryId,
				location: {
					latitude: params.location.latitude,
					longitude: params.location.longitude,
				},
				radius: params.distance,
				priceLevels: params.priceLevels,
				languageCode: params.localLanguageCode,
				// #817 端末言語でレビューの並びが変わるためキーに含める
				viewerLanguageCode: locale,
			});

			// #633 【設計】未取得 & 非ロード中の場合のみ fetch（重複実行を防止）
			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					const dishItems = await createDishItemsPromise(
						dishCategory.categoryId,
						dishCategory.category,
						params.location.latitude,
						params.location.longitude,
						params.localLanguageCode,
						params.distance,
						params.priceLevels,
					);
					upsertDishMediaEntries(dishItems);
					return dishItems.map((item) => String(item.dish_media.id));
				};
				updateMediaIdsByKeyAsync(entriesKey, getIds(), (_, fetched) => fetched);
			}

			// #1484 【設計】遷移そのものは拡大アニメーション完了後に行う（handleExpandComplete参照）。
			// フェッチ開始はここまでの処理で既に走っており、遷移の遅延では待たされない。
			const navigateToResult = () => {
				router.push({
					pathname: "/[locale]/(tabs)/search/result",
					params: {
						locale,
						entriesKey, // #633 【設計】dishCategoryId ではなく entriesKey を渡す
						...(params && { location: JSON.stringify(params.location) }),
						// #828 【設計】0件時のGoogle Maps検索はresult画面で判断するため、表示中カテゴリを渡す。
						category: dishCategory.category,
						// #1484 【仕様】店舗提案の取得完了まで、独立ローディング画面の代わりに選択した料理画像を表示し続ける。
						dishImageUrl: dishCategory.imageUrl,
					},
				});
				// #633 【設計】分析基盤互換のため移行期間は dishCategoryId と entriesKey を併記
				logFrontendEvent({
					event_name: "topic_view_details",
					error_level: "log",
					payload: { topic_id: dishCategory.categoryId, entries_key: entriesKey },
				});
			};

			if (originRect) {
				pendingNavigateRef.current = navigateToResult;
				const containerNode = screenContainerRef.current;
				const fallbackTargetRect = (): CardRect => {
					const { width, height } = Dimensions.get("window");
					return { x: 0, y: 0, width, height };
				};
				if (containerNode && typeof containerNode.measureInWindow === "function") {
					containerNode.measureInWindow((containerX, containerY, containerWidth, containerHeight) => {
						const targetRect: CardRect =
							containerWidth > 0 && containerHeight > 0
								? { x: 0, y: 0, width: containerWidth, height: containerHeight }
								: fallbackTargetRect();
						setExpandingCard({
							imageUrl: dishCategory.imageUrl,
							originRect: {
								x: originRect.x - containerX,
								y: originRect.y - containerY,
								width: originRect.width,
								height: originRect.height,
							},
							targetRect,
						});
					});
				} else {
					setExpandingCard({ imageUrl: dishCategory.imageUrl, originRect, targetRect: fallbackTargetRect() });
				}
			} else {
				// #1484 実測矩形が取れなかった場合（レイアウト未確定等）は、従来どおり即座に遷移する。
				navigateToResult();
			}
		},
		[locale, params, createDishItemsPromise, logFrontendEvent, showSnackbar],
	);

	const handleBack = () => {
		router.back();
	};

	/**
	 * #1499 【仕様】取得失敗画面の「再試行」ボタン。同じ params（+ pinnedDishCategory）で再取得する。
	 *
	 * ⚠️ state の反映を待たずに立つガード（isSelectingDishCategoryRef 等と同じ方式）。
	 * ボタン押下から re-render までの間の連打で `searchDishCategories` が二重に走るのを防ぐ。
	 * 再試行が再び失敗した場合も、setError により displayError が更新され、
	 * かつ Snackbar でも通知するため「無言で元のエラー表示に戻る」ことはない。
	 */
	const handleRetryDishCategories = useCallback(() => {
		if (!params || isRetryingDishCategoriesRef.current) return;
		isRetryingDishCategoriesRef.current = true;
		setIsRetryingDishCategories(true);
		const searchSessionKey = searchParams ?? "";
		searchDishCategories(params, { pinnedDishCategory })
			.then(() => {
				setLoadedSearchSessionKey(searchSessionKey);
			})
			.catch(() => {
				showSnackbar(i18n.t("DishCategories.errors.fetchFailed"));
			})
			.finally(() => {
				isRetryingDishCategoriesRef.current = false;
				setIsRetryingDishCategories(false);
			});
	}, [params, pinnedDishCategory, searchParams, searchDishCategories, showSnackbar]);

	const visibleDishCategories = useMemo(() => dishCategories.filter((dishCategory) => !dishCategory.isHidden), [dishCategories]);
	const isCarouselReady = cardHeight > 0 && visibleDishCategories.length > 0;
	// 旧検索結果が残る瞬間には開かず、現在の検索セッションの取得完了まで待つ。
	const canOpenDishCategoriesTutorial =
		!isLoading && !error && isCarouselReady && loadedSearchSessionKey === (searchParams ?? "");
	const {
		isTutorialRequested,
		tutorialRequestId,
		openReason: tutorialOpenReason,
		openManually: openDishCategoriesTutorialManually,
		close: closeDishCategoriesTutorial,
		markPresented: markDishCategoriesTutorialPresented,
	} = useDishCategoriesTutorial({ canAutoOpen: canOpenDishCategoriesTutorial });

	useEffect(() => {
		createdGroupVoteRef.current = null;
	}, [searchParams]);
	const handleOpenGroupVote = useCallback(async () => {
		if (!params?.location) {
			showSnackbar(i18n.t("DishCategories.errors.invalidSearchParams"));
			return;
		}

		// #1205 state の反映を待たずに立つガード。ここより後に push / 作成 API を書くこと。
		if (isOpeningGroupVoteRef.current) return;
		isOpeningGroupVoteRef.current = true;

		/**
		 * #1376 【バグ】`shareToken` が空のまま push すると、expo-router は動的セグメントを
		 * 解決できず **`[shareToken]` というリテラルのまま** URL に残す。その URL でサーバへ問い合わせると
		 * `getDetailByShareToken` が 404 を返し、`DishCategoryGroupVotes.getDetailFailed` が error で記録される。
		 * 本番ログには実際に `shareToken: "[shareToken]"` が届いており、認証済みユーザー 4 人が踏んでいた。
		 *
		 * ⚠️ **ここで弾くときは必ず `isOpeningGroupVoteRef` を解除すること。**
		 * この ref は「遷移したら解除しない（遷移先で useFocusEffect が解除する）」設計なので、
		 * 遷移せずに抜ける経路で解除を忘れると **ボタンが二度と押せなくなる**（#1205 と同じ罠）。
		 */
		const pushToGroupVote = (shareToken: string | null | undefined, source: "cache" | "created"): boolean => {
			if (!shareToken) {
				logFrontendEvent({
					event_name: "dish_category_group_vote_share_token_missing",
					error_level: "error",
					payload: { source },
				});
				isOpeningGroupVoteRef.current = false;
				showSnackbar(i18n.t("DishCategories.errors.fetchFailed"));
				return false;
			}

			router.push({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: {
					locale,
					shareToken,
				},
			});
			return true;
		};

		const cachedResponse = createdGroupVoteRef.current;
		if (cachedResponse) {
			logFrontendEvent({
				event_name: "dish_category_group_vote_create_reused",
				error_level: "log",
				payload: { shareToken: cachedResponse.shareToken },
			});
			pushToGroupVote(cachedResponse.shareToken, "cache");
			return;
		}

		try {
			const response = await createGroupVote({ searchParams: params, dishCategories: visibleDishCategories });
			// #1205 作成中の 2 発目として抑止された場合は null が返る。遷移すると結果画面が二重に開くため遷移しない。
			//（通常は上の ref で先に弾かれるので、ここは他の呼び出し経路からの多重実行に備えた保険）
			//
			// ⚠️ **解除を忘れないこと。** ここは «遷移しない» 唯一の成功経路なので、
			// ref を立てたまま抜けると useFocusEffect も走らず、**ボタンが二度と押せなくなる**。
			if (!response) {
				isOpeningGroupVoteRef.current = false;
				return;
			}
			// #1376 【設計】**遷移できた応答だけをキャッシュする。**
			// ここで無条件にキャッシュすると、shareToken の無い応答が居座って
			// 以降の再試行がすべてキャッシュ経路（= 同じ壊れた応答）へ流れ、
			// その検索セッションでは友達投票を二度と開けなくなる。
			if (pushToGroupVote(response.shareToken, "created")) {
				createdGroupVoteRef.current = response;
			}
		} catch {
			// #1205 失敗時は必ず解除する。ここを省くと「1 回失敗したら二度と開けない」になる。
			isOpeningGroupVoteRef.current = false;
			showSnackbar(i18n.t("DishCategories.errors.fetchFailed"));
		}
	}, [createGroupVote, locale, logFrontendEvent, params, showSnackbar, visibleDishCategories]);

	const { getImageState, retryImage, markImageError } = useDishCategoryImageResources({
		dishCategories: visibleDishCategories,
		sessionKey: searchParams ?? "",
	});

	/**
	 * 現在アクティブなdishCategoryの初回表示だけを記録する。
	 * dishCategoryが存在しないindexでは何も行わず、同一検索セッション内の再表示も送信しない。
	 */
	const logActiveDishCategoryImpression = useCallback(
		(index: number) => {
			const dishCategory = visibleDishCategories[index];
			if (!dishCategory || impressedDishCategoryIdsRef.current.has(dishCategory.categoryId)) return;

			// #907 【仕様】Carouselが事前描画したカードではなく、アクティブになったdishCategoryだけをimpressionとする。
			impressedDishCategoryIdsRef.current.add(dishCategory.categoryId);
			logFrontendEvent({
				event_name: "topic_impression",
				error_level: "log",
				payload: {
					topic_id: dishCategory.categoryId,
					display_index: index,
				},
			});
		},
		[logFrontendEvent, visibleDishCategories],
	);

	useEffect(() => {
		if (loadedSearchSessionKey !== (searchParams ?? "")) return;
		if (!isCarouselReady) return;
		// #907 【設計】初期表示・snap・block後の自動繰り上がりを同じ判定経路へ集約する。
		logActiveDishCategoryImpression(currentIndex);
	}, [currentIndex, isCarouselReady, loadedSearchSessionKey, logActiveDishCategoryImpression, searchParams]);

	// #615 visibleDishCategories 変化時に currentIndex を範囲内に clamp（範囲外アクセス防止）
	useEffect(() => {
		if (visibleDishCategories.length > 0 && currentIndex >= visibleDishCategories.length) {
			const newIndex = Math.max(0, visibleDishCategories.length - 1);
			setCurrentIndex(newIndex);
			// Carousel の表示位置も補正
			if (carouselRef.current) {
				carouselRef.current.scrollTo({ index: newIndex, animated: false });
			}
		}
		// @eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleDishCategories.length]);

	const handleSnapToItem = (index: number) => {
		const isThumbnailNavigation = thumbnailNavigationTargetRef.current === index;
		// #907 【設計】移動成否にかかわらず消費し、後続のユーザースワイプを誤って抑制しない。
		thumbnailNavigationTargetRef.current = null;

		selectionChanged();
		// #907 【仕様】topic_swiped_nextはジェスチャー操作だけを記録し、サムネイルによる直接移動を除外する。
		if (
			!isThumbnailNavigation &&
			index !== currentIndex &&
			index >= 0 &&
			index < visibleDishCategories.length &&
			currentIndex >= 0
		) {
			logFrontendEvent({
				event_name: "topic_swiped_next",
				error_level: "log",
				payload: {
					previous_index: currentIndex,
					new_index: index,
					previous_topic_id: visibleDishCategories[currentIndex]?.categoryId ?? null,
					new_topic_id: visibleDishCategories[index]?.categoryId ?? null,
				},
			});
		}
		setCurrentIndex(index);
	};

	// #674 【仕様】カード・メインCTAタップ時の処理。
	// 旧実装は「スクロール中はタップ無視」のガードがあったが、これは当時
	// visibleDishCategories[currentIndex] という index 参照で選択しており、スクロール中の
	// 曖昧な index による誤選択を防ぐためのものだった。現在は押されたカード自身の
	// dishCategory を直接受け取るため曖昧さはなく、ガードは「押下フィードバックは出るのに
	// 遷移しない」だけの挙動になっていたため撤去した(レビュー指摘)。
	// 実スワイプとタップの弁別は Carousel のジェスチャ制御に委ねる。
	const handleCardPress = useCallback(
		(dishCategory: DishCategoryRecommendation, originRect?: CardRect) => {
			handleViewDetails(dishCategory, originRect);
		},
		[handleViewDetails],
	);

	// #674 【仕様】サムネイルタップ時の処理
	// #1007 【設計】currentIndex を直接依存に含めると、スワイプのたびに handleThumbnailPress の参照が
	// 変わり DishCategoryThumbnail(React.memo)の props が全件変化してしまう。ref 経由で最新値を読むことで
	// 関数自体は安定させ、isActive の変化した2件だけが再レンダーされるようにする。
	const currentIndexRef = useRef(currentIndex);
	useEffect(() => {
		currentIndexRef.current = currentIndex;
	}, [currentIndex]);

	const handleThumbnailPress = useCallback((index: number) => {
		if (index === currentIndexRef.current || !carouselRef.current) return;

		// #907 【仕様】indexはsnap完了後に更新し、カード表示前のimpression送信を防ぐ。
		thumbnailNavigationTargetRef.current = index;
		carouselRef.current.scrollTo({ index, animated: true });
	}, []);

	const getDeepDiveLabel = useCallback((option: DishCategoryDeepDiveOption) => {
		if (option.featureType === "budget_intent") {
			const priceOption = priceLevelOptions.find((priceLevel) => priceLevel.budgetIntent === option.featureKey);
			return priceOption ? i18n.t(priceOption.label) : option.featureKey;
		}
		if (option.featureType === "dining_pace") {
			// #1015 【パフォーマンス】find() の代わりに priceLevelOptions と同型の派生Mapを参照する
			const paceOption = diningPaceOptionsById[option.featureKey];
			return paceOption ? `${paceOption.icon}${i18n.t(paceOption.label)}` : option.featureKey;
		}
		if (option.featureType === "taste") {
			const tasteOption = tasteOptionsById[option.featureKey];
			return tasteOption ? `${tasteOption.icon}${i18n.t(tasteOption.label)}` : option.featureKey;
		}
		if (option.featureType === "core_ingredient") {
			const coreOption = coreIngredientOptionsById[option.featureKey];
			return coreOption ? `${coreOption.icon}${i18n.t(coreOption.label)}` : option.featureKey;
		}
		return option.featureKey;
	}, []);

	// #1007 【設計】getDeepDiveOptions は Carousel の再レンダーのたびに全カード分呼ばれるため、
	// 同一検索セッション内では dishCategory.categoryId 単位で結果をキャッシュする。params が変わると
	// 深掘り候補の算出条件自体が変わるため、params 変化時にキャッシュを破棄する。
	// #1007 【設計】label は i18n.t() 済みの文字列を保持するため、キーへ locale も含める。
	// params はロケール変更では変わらず、画面を維持したままロケールが変わると
	// useDishCategorySearch が同じ categoryId を新しい言語で再取得しても旧ロケールのラベルが返り続けるため、
	// effect ではなくキー側で無効化して同一レンダー内で新しい言語に切り替わるようにする。
	const deepDiveOptionsCacheRef = useRef<Map<string, DishCategoryDeepDiveOption[]>>(new Map());
	useEffect(() => {
		deepDiveOptionsCacheRef.current = new Map();
	}, [params]);

	const getDeepDiveOptions = useCallback(
		(dishCategory: DishCategoryRecommendation): DishCategoryDeepDiveOption[] => {
			if (!params?.location) return [];
			const cacheKey = `${locale}:${dishCategory.categoryId}`;
			const cached = deepDiveOptionsCacheRef.current.get(cacheKey);
			if (cached) return cached;
			const features = (dishCategory.deepDiveFeatures ?? []).filter((feature) => {
				if (feature.score <= DEEP_DIVE_SCORE_THRESHOLD) return false;
				if (feature.feature_type === "budget_intent") {
					return ALLOWED_DEEP_DIVE_KEYS.budget_intent.has(
						feature.feature_key as (typeof priceLevelOptions)[number]["budgetIntent"],
					);
				}
				if (feature.feature_type === "dining_pace") {
					return ALLOWED_DEEP_DIVE_KEYS.dining_pace.has(
						feature.feature_key as (typeof diningPaceOptions)[number]["id"],
					);
				}
				if (feature.feature_type === "taste") {
					return ALLOWED_DEEP_DIVE_KEYS.taste.has(feature.feature_key as (typeof tasteOptions)[number]["id"]);
				}
				if (feature.feature_type === "core_ingredient") {
					return ALLOWED_DEEP_DIVE_KEYS.core_ingredient.has(
						feature.feature_key as (typeof coreIngredientOptions)[number]["id"],
					);
				}
				return false;
			});
			const selectedBudgetIntent = deriveBudgetIntentFromPriceLevels(params.priceLevels);

			const budgetCandidates = selectedBudgetIntent?.length
				? []
				: features
						.filter((feature) => feature.feature_type === "budget_intent")
						.sort(
							(a, b) =>
								b.score - a.score ||
								getOrderIndex(BUDGET_INTENT_ORDER, a.feature_key) - getOrderIndex(BUDGET_INTENT_ORDER, b.feature_key),
						)
						.slice(0, 1);

			const diningPaceCandidates = params.diningPace
				? []
				: features
						.filter((feature) => feature.feature_type === "dining_pace")
						.sort(
							(a, b) =>
								b.score - a.score ||
								getOrderIndex(DINING_PACE_ORDER, a.feature_key) - getOrderIndex(DINING_PACE_ORDER, b.feature_key),
						)
						.slice(0, 1);

			const foodStyleCandidates =
				params.taste || params.coreIngredient
					? []
					: features
							.filter((feature) => feature.feature_type === "taste" || feature.feature_type === "core_ingredient")
							.sort(
								(a, b) =>
									b.score - a.score ||
									getOrderIndex(FOOD_STYLE_ORDER, a.feature_key) - getOrderIndex(FOOD_STYLE_ORDER, b.feature_key),
							);

			const result = [...budgetCandidates, ...diningPaceCandidates, ...foodStyleCandidates]
				.slice(0, 3)
				.map((feature) => {
					const option = {
						key: `${feature.feature_type}:${feature.feature_key}`,
						label: "",
						featureType: feature.feature_type,
						featureKey: feature.feature_key,
					};
					return { ...option, label: getDeepDiveLabel(option) };
				});
			deepDiveOptionsCacheRef.current.set(cacheKey, result);
			return result;
		},
		[getDeepDiveLabel, locale, params],
	);

	const handleDeepDive = useCallback(
		(dishCategory: DishCategoryRecommendation, option: DishCategoryDeepDiveOption) => {
			if (!params?.location) return;

			const nextParams: SearchParams = { ...params };
			if (option.featureType === "budget_intent") {
				const priceLevel = budgetIntentToPriceLevel[option.featureKey as keyof typeof budgetIntentToPriceLevel];
				if (priceLevel) nextParams.priceLevels = [priceLevel];
			} else if (option.featureType === "dining_pace") {
				nextParams.diningPace = option.featureKey as SearchParams["diningPace"];
			} else if (option.featureType === "taste") {
				nextParams.taste = option.featureKey as SearchParams["taste"];
				nextParams.coreIngredient = undefined;
			} else if (option.featureType === "core_ingredient") {
				nextParams.coreIngredient = option.featureKey as SearchParams["coreIngredient"];
				nextParams.taste = undefined;
			}

			logFrontendEvent({
				event_name: "topic_deep_dive_selected",
				error_level: "log",
				payload: {
					topic_id: dishCategory.categoryId,
					feature_type: option.featureType,
					feature_key: option.featureKey,
				},
			});

			router.push({
				pathname: "/[locale]/(tabs)/search/dish-categories",
				params: {
					locale,
					searchParams: JSON.stringify(nextParams),
					pinnedDishCategory: JSON.stringify(dishCategory),
				},
			});
		},
		[locale, logFrontendEvent, params],
	);

	/**
	 * #927 【設計】表示中カードの深掘り有無を、カード描画とチュートリアルで共有する。
	 *
	 * 別々に判定すると、片方だけ候補ありと判断したタイミングで
	 * 「存在しないdeepDiveを説明する」競合が起きるため、同じ配列を使う。
	 */
	const activeDeepDiveOptions = useMemo(() => {
		const activeDishCategory = visibleDishCategories[currentIndex];
		return activeDishCategory ? getDeepDiveOptions(activeDishCategory) : [];
	}, [currentIndex, getDeepDiveOptions, visibleDishCategories]);

	// #1007 【設計】isSaved を useDishCategoriesStore の dishCategory.categoryId 単位のスライスへ外出ししたため、
	// カード再利用時も保存状態はstore側で引き継がれる。Carousel の key を撤去してカード再利用を有効化し、
	// DishMediaMap.tsx の renderCarouselItem と同様に renderItem 自体も useCallback で安定化する。
	const renderCard = useCallback(
		({ item, index }: { item: DishCategoryRecommendation; index: number }) => {
			const imageState = getImageState(item);
			const isActiveCard = index === currentIndex;
			return (
				<DishCategoryCard
					item={item}
					onBlock={handleBlockCard}
					onDeepDive={handleDeepDive}
					onSelect={handleCardPress}
					deepDiveOptions={isActiveCard ? activeDeepDiveOptions : getDeepDiveOptions(item)}
					cardWidth={cardWidth}
					cardHeight={cardHeight}
					imageState={imageState}
					isSelecting={isSelectingDishCategory}
					onImageRetry={retryImage}
					onImageLoadError={markImageError}
					// 非表示カードによるref上書きを防ぐため、アクティブカードにだけ登録する。
					tutorialTargetRefs={isActiveCard ? tutorialTargetRefs : undefined}
				/>
			);
		},
		[
			getImageState,
			currentIndex,
			handleBlockCard,
			handleDeepDive,
			handleCardPress,
			activeDeepDiveOptions,
			getDeepDiveOptions,
			cardWidth,
			cardHeight,
			isSelectingDishCategory,
			retryImage,
			markImageError,
			tutorialTargetRefs,
		],
	);

	// #1499 【設計】再試行中(isRetryingDishCategories)は、内部で isLoading が true になっても
	// DishCategoriesLoading へ切り替えず DishCategoriesError を維持する。ボタンを非活性のまま表示し続けることで、
	// 「再試行中であること」がユーザーに読める状態を保つ（DishCategoriesLoading への切替だとボタンごと消えてしまう）。
	if (isLoading && !isRetryingDishCategories) {
		return <DishCategoriesLoading />;
	}

	if (error || isRetryingDishCategories) {
		return (
			<DishCategoriesError
				error={displayError ?? error ?? i18n.t("DishCategories.errors.fetchFailed")}
				onBack={handleBack}
				onRetry={handleRetryDishCategories}
				isRetrying={isRetryingDishCategories}
			/>
		);
	}

	// #747 【仕様】リロードアイコンの表示条件：params が存在 && 表示中のトピックが0〜3件
	const shouldShowReload = !!params && visibleDishCategories.length >= 0 && visibleDishCategories.length <= 3;

	const handleReloadRecommendations = () => {
		if (!params?.location) return;
		showDialog(i18n.t("DishCategories.reloadDialog.message"), {
			title: i18n.t("DishCategories.reloadDialog.title"),
			okLabel: i18n.t("DishCategories.reloadDialog.confirm"),
			cancelLabel: i18n.t("DishCategories.reloadDialog.cancel"),
			onConfirm: async () => {
				try {
					await refillDishCategories(params);
				} catch {
					showSnackbar(i18n.t("DishCategories.errors.fetchFailed"));
				}
			},
		});
	};

	return (
		<View style={styles.container} ref={screenContainerRef} collapsable={false}>
			{/* #674 【仕様】ヘッダー（戻るボタン + タイトル） */}
			{/* #1031 【設計】Detox からタイトル表示を検証できるよう testID を追加 */}
			<ScreenHeader
				testID="dish-categories-header"
				title={i18n.t("DishCategories.headerTitle")}
				onPressBack={handleBack}
				rightContent={
					<View style={styles.headerActions}>
						{/* #927 【仕様】閲覧済みでも「？」から先頭ステップを再表示できる。 */}
						<TouchableOpacity
							onPress={openDishCategoriesTutorialManually}
							disabled={!canOpenDishCategoriesTutorial || isTutorialRequested}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("DishCategories.tutorial.helpLabel")}
							accessibilityHint={i18n.t("DishCategories.tutorial.helpHint")}
							hitSlop={HEADER_ACTION_HIT_SLOP}
							testID="dish-categories-tutorial-help"
							style={[
								styles.headerActionButton,
								(!canOpenDishCategoriesTutorial || isTutorialRequested) && styles.headerActionButtonDisabled,
							]}>
							<CircleHelp size={20} color={colors.textPrimary} />
						</TouchableOpacity>
						<View ref={groupVoteTutorialRef} collapsable={false} testID="dish-categories-tutorial-target-group-vote">
							<TouchableOpacity
								onPress={handleOpenGroupVote}
								disabled={isCreating}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("DishCategoryGroupVotes.resultTitle")}
								hitSlop={HEADER_ACTION_HIT_SLOP}
								testID="dish-categories-group-vote"
								style={[styles.headerActionButton, isCreating && styles.headerActionButtonDisabled]}>
								<Users size={20} color={colors.textPrimary} />
							</TouchableOpacity>
						</View>
						{shouldShowReload && (
							<TouchableOpacity
								onPress={handleReloadRecommendations}
								accessibilityRole="button"
								hitSlop={HEADER_ACTION_HIT_SLOP}
								style={styles.headerActionButton}>
								<RefreshCw size={20} color={colors.textPrimary} />
							</TouchableOpacity>
						)}
					</View>
				}
			/>

			{/* #674 【仕様】条件チップ表示 */}
			{params && (
				<View style={styles.chipsContainer}>
					<View style={styles.chipRow}>
						{/* 場所 */}
						<View style={styles.conditionChip}>
							<MapPin size={14} color={colors.brand} />
							<Text style={styles.conditionChipText}>{params.locationQuery}</Text>
						</View>

						{/* 時間帯 */}
						{/* #1015 【パフォーマンス】find() の代わりに priceLevelOptions と同型の派生Mapを参照する */}
						<View style={styles.conditionChip}>
							<SunMoon size={14} color={colors.brand} />
							<Text style={styles.conditionChipText}>{i18n.t(timeSlotsById[params.timeSlot]?.label || "")}</Text>
						</View>

						{/* 誰と行くか */}
						<View style={styles.conditionChip}>
							<Users size={14} color={colors.brand} />
							<Text style={styles.conditionChipText}>{i18n.t(sceneOptionsById[params.scene]?.label || "")}</Text>
						</View>
					</View>

					<View style={styles.chipRow}>
						{/* 価格帯（budgetIntent が選択されている場合のみ） */}
						{deriveBudgetIntentFromPriceLevels(params.priceLevels)?.map((budgetIntent) => {
							const priceOption = priceLevelOptions.find((option) => option.budgetIntent === budgetIntent);
							if (!priceOption) return null;
							return (
								<View key={budgetIntent} style={styles.conditionChip}>
									<DollarSign size={14} color={colors.brand} />
									<Text style={styles.conditionChipText}>{i18n.t(priceOption.label)}</Text>
								</View>
							);
						})}

						{/* 食事にかける時間（diningPace が選択されている場合のみ） */}
						{params.diningPace && (
							<View style={styles.conditionChip}>
								<Timer size={14} color={colors.brand} />
								<Text style={styles.conditionChipText}>
									{i18n.t(diningPaceOptionsById[params.diningPace]?.label || "")}
								</Text>
							</View>
						)}

						{/* 味の好み（taste が選択されている場合のみ） */}
						{params.taste && (
							<View style={styles.conditionChip}>
								<ChefHat size={14} color={colors.brand} />
								<Text style={styles.conditionChipText}>{i18n.t(tasteOptionsById[params.taste]?.label || "")}</Text>
							</View>
						)}

						{/* 中核食材・主食系（coreIngredient が選択されている場合のみ） */}
						{params.coreIngredient && (
							<View style={styles.conditionChip}>
								<ChefHat size={14} color={colors.brand} />
								<Text style={styles.conditionChipText}>
									{i18n.t(coreIngredientOptionsById[params.coreIngredient]?.label || "")}
								</Text>
							</View>
						)}
					</View>
				</View>
			)}

			{/* #674 【仕様】サブコピー */}
			<Text style={styles.subCopy}>{i18n.t("DishCategories.subCopy")}</Text>

			{/* 中央のメイン領域（カルーセル＋サムネイル） */}
			<View style={styles.main}>
				{/* 空き高さを onLayout で測って、カルーセル高さを決定 */}
				<View
					style={styles.carouselOuter}
					onLayout={(e) => {
						setCarouselAvailableHeight(e.nativeEvent.layout.height);
					}}>
					{visibleDishCategories.length > 0 ? (
						cardHeight > 0 && (
							<View style={styles.carouselContainer}>
								{/* #1156 carousel v5: width/height は style へ、mode/modeConfig は layout へ移行。
								    v5 は loop の既定が false になったため、v4 の挙動を保つよう明示する。 */}
								<Carousel
									ref={carouselRef}
									data={visibleDishCategories}
									renderItem={renderCard}
									onSnapToItem={handleSnapToItem}
									loop
									/*
									#1629【オーナー確定】**中央のカードは左右の余白なしで出す（#1212 の指定どおり）。**

									`parallax` は **アクティブなカードにも `scale` を掛ける**ので、
									`scale: 0.9` だと中央のカードが中央カラム幅の 0.9 倍になる
									（実測 504px / 期待 560px）。#1212 の «左右の余白が無い» は満たせない。

									`scale: 1` にして中央のカードを等倍にする。`offset` は隣のカードを
									どれだけ覗かせるかで、中央の幅には効かないのでそのまま残す。
									*/
									layout={{
										type: "parallax",
										scale: 1,
										offset: 100,
									}}
									style={{ width: cardWidth, height: cardHeight + DISH_CATEGORY_CARD_CTA_OVERHANG }}
								/>
							</View>
						)
					) : (
						<View style={styles.emptyContainer}></View>
					)}
				</View>

				{/* ✅ 下部サムネイル：absolute ではなく通常フローの一番下 */}
				{visibleDishCategories.length > 0 && (
					<View style={styles.thumbnailGrid}>
						{visibleDishCategories.map((dishCategory, index) => (
							// #1007 【設計】DishCategoryThumbnail(React.memo)へ分離し、isActive/imageState 以外の
							// props(onPress/onImageError含む)を安定参照にすることで、スワイプ時の
							// 再レンダー範囲を「旧選択」「新選択」の2件のみに抑える。
							<DishCategoryThumbnail
								key={dishCategory.categoryId}
								dishCategory={dishCategory}
								index={index}
								total={visibleDishCategories.length}
								isActive={currentIndex === index}
								// #929 【設計】メインカードと同じ imageState を参照し、画面単位で1回だけ取得したリソースを共有する。
								imageState={getImageState(dishCategory)}
								// #958 【修正】サムネイル幅は中央カラム幅に追従させる
								width={(contentWidth - 72) / 6}
								onPress={handleThumbnailPress}
								onImageError={markImageError}
							/>
						))}
					</View>
				)}
			</View>

			{/* #927 BottomSheetではなく、実UIの位置を指す画面専用スポットライト。 */}
			<DishCategoriesSpotlightTutorial
				visible={isTutorialRequested}
				requestId={tutorialRequestId}
				openReason={tutorialOpenReason}
				targetRefs={tutorialTargetRefs}
				includeDeepDiveStep={activeDeepDiveOptions.length > 0}
				onPresented={markDishCategoriesTutorialPresented}
				onClose={closeDishCategoriesTutorial}
				onUnavailable={closeDishCategoriesTutorial}
			/>

			{/* #1484 【仕様】「この料理にする！」押下位置から画面いっぱいに広がるアニメーション。
			    広がり切ったら handleExpandComplete が予約済みの画面遷移を実行する。 */}
			{expandingCard && (
				<DishCategoryCardExpandTransition
					imageUrl={expandingCard.imageUrl}
					originRect={expandingCard.originRect}
					targetRect={expandingCard.targetRect}
					onExpandComplete={handleExpandComplete}
				/>
			)}
		</View>
	);
}

// #1629 【修正】この画面はカード（写真）以外がすべてライト固定の直書きで、ダークにしても
// 白い地に黒い文字のままだった。色の «役割» は変えていない（ブランド色のチップはブランド色のまま）。
const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			// 画面の地。ライトの見た目を変えないため background（わずかに灰）ではなく surface を使う
			backgroundColor: colors.surface,
		},
		chipsContainer: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			gap: 8,
		},
		chipRow: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: 8,
		},
		conditionChip: {
			flexDirection: "row",
			alignItems: "center",
			backgroundColor: colors.brandTint,
			paddingHorizontal: 12,
			paddingVertical: 6,
			borderRadius: 24,
			gap: 4,
		},
		conditionChipText: {
			fontSize: 13,
			color: colors.brand,
			fontWeight: "500",
		},
		subCopy: {
			fontSize: 14,
			color: colors.textSecondary,
			textAlign: "center",
			paddingHorizontal: 20,
			lineHeight: 20,
		},
		headerActions: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			minHeight: 32,
		},
		headerActionButton: {
			padding: 4,
		},
		headerActionButtonDisabled: {
			opacity: 0.35,
		},
		retryButton: {
			backgroundColor: colors.brand,
			paddingHorizontal: 24,
			paddingVertical: 16,
			borderRadius: 16,
			shadowColor: colors.brand,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 12,
			elevation: 6,
		},
		retryButtonText: {
			fontSize: 16,
			// ブランド色で塗った CTA の上の文字。地がライト / ダークで変わらないため文字も振らない
			color: FixedColors.onFilled,
			fontWeight: "600",
			letterSpacing: 0.3,
		},
		// ✅ 中央コンテンツ全体（カルーセル + サムネ）
		main: {
			flex: 1,
		},
		// ✅ カルーセル用の空きスペース（ここが flex:1）
		carouselOuter: {
			flex: 1,
			justifyContent: "center",
		},
		carouselContainer: {
			justifyContent: "center",
			alignItems: "center",
		},
		// #958 【修正】width は中央カラム幅に追従させる必要があるため JSX 側でインライン合成する
		emptyContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: 24,
		},
		emptyCard: {
			backgroundColor: colors.surface,
			borderRadius: 24,
			padding: 32,
			alignItems: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 8 },
			shadowOpacity: 0.12,
			shadowRadius: 24,
			elevation: 8,
			width: "100%",
			maxWidth: 320,
		},
		emptyText: {
			fontSize: 18,
			color: colors.textSecondary,
			textAlign: "center",
			marginBottom: 24,
			lineHeight: 28,
			fontWeight: "500",
		},
		// 下部サムネイル（通常フローで一番下）
		// #1007 【設計】個々のサムネイルのスタイル(thumbnail/thumbnailActive/thumbnailImage)は
		// DishCategoryThumbnail.tsx へ移動した。
		thumbnailGrid: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			flexDirection: "row",
			flexWrap: "wrap",
			justifyContent: "center",
			gap: 8,
		},
	});
