import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { MapPin, SunMoon, Users, ChefHat, RefreshCw, DollarSign, Timer } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import Carousel from "react-native-reanimated-carousel";
import { Image } from "expo-image";
import { Topic, SearchParams } from "@/types/search";
import { useTopicSearch } from "@/features/topics/hooks/useTopicSearch";
import { useBlockTopic } from "@/features/topics/hooks/useBlockTopic";
import { TopicCard, TOPIC_CARD_CTA_OVERHANG, type TopicDeepDiveOption } from "@/features/topics/components/TopicCard";
import { useTopicImageResources } from "@/features/topics/hooks/useTopicImageResources";
import { TopicsLoading } from "@/features/topics/components/TopicsLoading";
import { TopicsError } from "@/features/topics/components/TopicsError";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { CARD_WIDTH, CARD_MAX_HEIGHT, width as SCREEN_WIDTH } from "@/features/topics/constants";
import {
	budgetIntentToPriceLevel,
	coreIngredientOptions,
	deriveBudgetIntentFromPriceLevels,
	diningPaceOptions,
	foodStyleOptions,
	priceLevelOptions,
	sceneOptions,
	tasteOptions,
	timeSlots,
} from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";
import { WIKIMEDIA_HEADERS } from "@/lib/wikimedia";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useCreateDishCategoryGroupVote } from "@/features/dishCategoryGroupVotes/hooks/useCreateDishCategoryGroupVote";
import type { CreateDishCategoryGroupVoteResponse } from "@shared/api/v1/res";

const DEEP_DIVE_SCORE_THRESHOLD = 0.85;

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

export default function TopicsScreen() {
	const { locale } = useLocale();
	const { searchParams, pinnedTopic: pinnedTopicParam } = useLocalSearchParams<{
		searchParams: string;
		pinnedTopic?: string;
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
	const pinnedTopic = useMemo(() => {
		if (!pinnedTopicParam) return null;
		try {
			return JSON.parse(pinnedTopicParam) as Topic;
		} catch {
			return null;
		}
	}, [pinnedTopicParam]);
	const { logFrontendEvent } = useLogger();
	const [isScrolling, setIsScrolling] = useState(false);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [loadedSearchSessionKey, setLoadedSearchSessionKey] = useState<string | null>(null);
	const [carouselAvailableHeight, setCarouselAvailableHeight] = useState(0);
	const carouselRef = useRef<any>(null);
	// #907 【設計】サムネイルによるプログラム移動だけを識別し、スワイプ分析へ混在させない。
	const thumbnailNavigationTargetRef = useRef<number | null>(null);
	const createdGroupVoteRef = useRef<CreateDishCategoryGroupVoteResponse | null>(null);
	// #907 【設計】描画ライフサイクルと閲覧実績を分離し、検索セッション内のtopic単位で重複を防ぐ。
	const impressedTopicIdsRef = useRef<Set<string>>(new Set());
	const { selectionChanged } = useHaptics();

	const { topics, isLoading, error, searchTopics, refillTopics, hideTopic, unhideTopic, createDishItemsPromise } =
		useTopicSearch();
	const { showSnackbar } = useSnackbar();
	const { showDialog } = useDialog();
	const { handleBlockCard } = useBlockTopic(hideTopic, unhideTopic, showSnackbar);
	const { createGroupVote, isCreating } = useCreateDishCategoryGroupVote();
	// #907 【設計】Carouselのmount条件とimpressionの準備条件で同じ高さを参照する。
	const cardHeight = useMemo(() => {
		if (carouselAvailableHeight <= 0) return 0;
		const heightWithMargin = carouselAvailableHeight - TOPIC_CARD_CTA_OVERHANG;
		return Math.min(heightWithMargin, CARD_MAX_HEIGHT);
	}, [carouselAvailableHeight]);

	useEffect(() => {
		const searchSessionKey = searchParams ?? "";
		// #907 【仕様】検索開始時に閲覧記録を無効化し、旧topicsを新しい検索セッションへ混在させない。
		setLoadedSearchSessionKey(null);
		impressedTopicIdsRef.current.clear();
		thumbnailNavigationTargetRef.current = null;
		setCurrentIndex(0);
		if (carouselRef.current) {
			carouselRef.current.scrollTo({ index: 0, animated: false });
		}

		if (params) {
			searchTopics(params, { pinnedTopic })
				.then(() => {
					// #907 【設計】完了した検索キーを保持し、取得中に残る旧topicsのimpression送信を抑止する。
					setLoadedSearchSessionKey(searchSessionKey);
				})
				.catch(() => {
					// useTopicSearch は再試行と状態管理を担当し、画面側が最終失敗をSnackbarで可視化する。
					showSnackbar(i18n.t("Topics.errors.fetchFailed"));
				});
		} else {
			showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
			router.back();
		}
	}, [params, pinnedTopic, searchParams, searchTopics, showSnackbar, router]);

	const handleViewDetails = useCallback(
		(topic: Topic) => {
			// #633 【Blocker】params が undefined の場合は早期 return（クラッシュ防止）
			if (!params) {
				showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
				return;
			}

			// #633 【設計】SavedTopicsTab と同じパターンで entriesKey 駆動のオンデマンド取得
			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();

			// #633 【設計】entriesKey を生成（検索条件から一意のキーを作成）
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: topic.categoryId,
				location: {
					latitude: params.location.latitude,
					longitude: params.location.longitude,
				},
				radius: params.distance,
				priceLevels: params.priceLevels,
				languageCode: params.localLanguageCode,
			});

			// #633 【設計】未取得 & 非ロード中の場合のみ fetch（重複実行を防止）
			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					const dishItems = await createDishItemsPromise(
						topic.categoryId,
						topic.category,
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

			router.push({
				pathname: "/[locale]/(tabs)/search/result",
				params: {
					locale,
					entriesKey, // #633 【設計】topicId ではなく entriesKey を渡す
					...(params && { location: JSON.stringify(params.location) }),
					// #828 【設計】0件時のGoogle Maps検索はresult画面で判断するため、表示中カテゴリを渡す。
					category: topic.category,
				},
			});
			// #633 【設計】分析基盤互換のため移行期間は topicId と entriesKey を併記
			logFrontendEvent({
				event_name: "topic_view_details",
				error_level: "log",
				payload: { topic_id: topic.categoryId, entries_key: entriesKey },
			});
		},
		[locale, params, createDishItemsPromise, logFrontendEvent, showSnackbar],
	);

	const handleBack = () => {
		router.back();
	};

	const visibleTopics = useMemo(() => topics.filter((topic) => !topic.isHidden), [topics]);
	const isCarouselReady = cardHeight > 0 && visibleTopics.length > 0;

	useEffect(() => {
		createdGroupVoteRef.current = null;
	}, [searchParams]);
	const handleOpenGroupVote = useCallback(async () => {
		if (!params) {
			showSnackbar(i18n.t("Topics.errors.invalidSearchParams"));
			return;
		}

		const cachedResponse = createdGroupVoteRef.current;
		if (cachedResponse) {
			logFrontendEvent({
				event_name: "dish_category_group_vote_create_reused",
				error_level: "log",
				payload: { shareToken: cachedResponse.shareToken },
			});
			router.push({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: {
					locale,
					shareToken: cachedResponse.shareToken,
				},
			});
			return;
		}

		try {
			const response = await createGroupVote({ searchParams: params, topics: visibleTopics });
			createdGroupVoteRef.current = response;
			router.push({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: {
					locale,
					shareToken: response.shareToken,
				},
			});
		} catch {
			showSnackbar(i18n.t("Topics.errors.fetchFailed"));
		}
	}, [createGroupVote, locale, logFrontendEvent, params, showSnackbar, visibleTopics]);

	const { getImageState, retryImage } = useTopicImageResources({
		topics: visibleTopics,
		sessionKey: searchParams ?? "",
	});

	/**
	 * 現在アクティブなtopicの初回表示だけを記録する。
	 * topicが存在しないindexでは何も行わず、同一検索セッション内の再表示も送信しない。
	 */
	const logActiveTopicImpression = useCallback(
		(index: number) => {
			const topic = visibleTopics[index];
			if (!topic || impressedTopicIdsRef.current.has(topic.categoryId)) return;

			// #907 【仕様】Carouselが事前描画したカードではなく、アクティブになったtopicだけをimpressionとする。
			impressedTopicIdsRef.current.add(topic.categoryId);
			logFrontendEvent({
				event_name: "topic_impression",
				error_level: "log",
				payload: {
					topic_id: topic.categoryId,
					display_index: index,
				},
			});
		},
		[logFrontendEvent, visibleTopics],
	);

	useEffect(() => {
		if (loadedSearchSessionKey !== (searchParams ?? "")) return;
		if (!isCarouselReady) return;
		// #907 【設計】初期表示・snap・block後の自動繰り上がりを同じ判定経路へ集約する。
		logActiveTopicImpression(currentIndex);
	}, [currentIndex, isCarouselReady, loadedSearchSessionKey, logActiveTopicImpression, searchParams]);

	// #615 visibleTopics 変化時に currentIndex を範囲内に clamp（範囲外アクセス防止）
	useEffect(() => {
		if (visibleTopics.length > 0 && currentIndex >= visibleTopics.length) {
			const newIndex = Math.max(0, visibleTopics.length - 1);
			setCurrentIndex(newIndex);
			// Carousel の表示位置も補正
			if (carouselRef.current) {
				carouselRef.current.scrollTo({ index: newIndex, animated: false });
			}
		}
		// @eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleTopics.length]);

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
			index < visibleTopics.length &&
			currentIndex >= 0
		) {
			logFrontendEvent({
				event_name: "topic_swiped_next",
				error_level: "log",
				payload: {
					previous_index: currentIndex,
					new_index: index,
					previous_topic_id: visibleTopics[currentIndex]?.categoryId ?? null,
					new_topic_id: visibleTopics[index]?.categoryId ?? null,
				},
			});
		}
		setCurrentIndex(index);
	};

	// #674 【仕様】カード・メインCTAタップ時の処理（スクロール中は無視）
	const handleCardPress = useCallback(
		(topic: Topic) => {
			if (isScrolling) return;
			handleViewDetails(topic);
		},
		[handleViewDetails, isScrolling],
	);

	// #674 【仕様】サムネイルタップ時の処理
	const handleThumbnailPress = useCallback(
		(index: number) => {
			if (index === currentIndex || !carouselRef.current) return;

			// #907 【仕様】indexはsnap完了後に更新し、カード表示前のimpression送信を防ぐ。
			thumbnailNavigationTargetRef.current = index;
			carouselRef.current.scrollTo({ index, animated: true });
		},
		[currentIndex],
	);

	const getDeepDiveLabel = useCallback((option: TopicDeepDiveOption) => {
		if (option.featureType === "budget_intent") {
			const priceOption = priceLevelOptions.find((priceLevel) => priceLevel.budgetIntent === option.featureKey);
			return priceOption ? i18n.t(priceOption.label) : option.featureKey;
		}
		if (option.featureType === "dining_pace") {
			const paceOption = diningPaceOptions.find((pace) => pace.id === option.featureKey);
			return paceOption ? `${paceOption.icon}${i18n.t(paceOption.label)}` : option.featureKey;
		}
		if (option.featureType === "taste") {
			const tasteOption = tasteOptions.find((taste) => taste.id === option.featureKey);
			return tasteOption ? `${tasteOption.icon}${i18n.t(tasteOption.label)}` : option.featureKey;
		}
		if (option.featureType === "core_ingredient") {
			const coreOption = coreIngredientOptions.find((coreIngredient) => coreIngredient.id === option.featureKey);
			return coreOption ? `${coreOption.icon}${i18n.t(coreOption.label)}` : option.featureKey;
		}
		return option.featureKey;
	}, []);

	const getDeepDiveOptions = useCallback(
		(topic: Topic): TopicDeepDiveOption[] => {
			if (!params) return [];
			const features = (topic.deepDiveFeatures ?? []).filter((feature) => {
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

			return [...budgetCandidates, ...diningPaceCandidates, ...foodStyleCandidates].slice(0, 3).map((feature) => {
				const option = {
					key: `${feature.feature_type}:${feature.feature_key}`,
					label: "",
					featureType: feature.feature_type,
					featureKey: feature.feature_key,
				};
				return { ...option, label: getDeepDiveLabel(option) };
			});
		},
		[getDeepDiveLabel, params],
	);

	const handleDeepDive = useCallback(
		(topic: Topic, option: TopicDeepDiveOption) => {
			if (!params) return;

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
					topic_id: topic.categoryId,
					feature_type: option.featureType,
					feature_key: option.featureKey,
				},
			});

			router.push({
				pathname: "/[locale]/(tabs)/search/topics",
				params: {
					locale,
					searchParams: JSON.stringify(nextParams),
					pinnedTopic: JSON.stringify(topic),
				},
			});
		},
		[locale, logFrontendEvent, params],
	);

	const renderCard = ({ item, index }: { item: Topic; index: number }) => {
		const imageState = getImageState(item);
		return (
			<TopicCard
				// Carousel は index で要素を再利用するため、非表示後に次の料理の state/画像を引き継がないよう再マウントする。
				key={item.categoryId}
				item={item}
				onBlock={handleBlockCard}
				onDeepDive={handleDeepDive}
				onSelect={handleCardPress}
				deepDiveOptions={getDeepDiveOptions(item)}
				cardHeight={cardHeight}
				imageState={imageState}
				onImageRetry={retryImage}
			/>
		);
	};

	if (isLoading) {
		return <TopicsLoading />;
	}

	if (error) {
		return <TopicsError error={error} onBack={handleBack} />;
	}

	// #747 【仕様】リロードアイコンの表示条件：params が存在 && 表示中のトピックが0〜3件
	const shouldShowReload = !!params && visibleTopics.length >= 0 && visibleTopics.length <= 3;

	const handleReloadRecommendations = () => {
		if (!params) return;
		showDialog(i18n.t("Topics.reloadDialog.message"), {
			title: i18n.t("Topics.reloadDialog.title"),
			okLabel: i18n.t("Topics.reloadDialog.confirm"),
			cancelLabel: i18n.t("Topics.reloadDialog.cancel"),
			onConfirm: async () => {
				try {
					await refillTopics(params);
				} catch {
					showSnackbar(i18n.t("Topics.errors.fetchFailed"));
				}
			},
		});
	};

	return (
		<View style={styles.container}>
			{/* #674 【仕様】ヘッダー（戻るボタン + タイトル） */}
			<ScreenHeader
				title={i18n.t("Topics.headerTitle")}
				onPressBack={handleBack}
				rightContent={
					<View style={styles.headerActions}>
						<TouchableOpacity
							onPress={handleOpenGroupVote}
							disabled={isCreating}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("DishCategoryGroupVotes.resultTitle")}
							style={[styles.headerActionButton, isCreating && styles.headerActionButtonDisabled]}>
							<Users size={20} color="#1A1A1A" />
						</TouchableOpacity>
						{shouldShowReload && (
							<TouchableOpacity
								onPress={handleReloadRecommendations}
								accessibilityRole="button"
								style={styles.headerActionButton}>
								<RefreshCw size={20} color="#1A1A1A" />
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
							<MapPin size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>{params.locationQuery}</Text>
						</View>

						{/* 時間帯 */}
						<View style={styles.conditionChip}>
							<SunMoon size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>
								{i18n.t(timeSlots.find((s) => s.id === params.timeSlot)?.label || "")}
							</Text>
						</View>

						{/* 誰と行くか */}
						<View style={styles.conditionChip}>
							<Users size={14} color="#f05537" />
							<Text style={styles.conditionChipText}>
								{i18n.t(sceneOptions.find((s) => s.id === params.scene)?.label || "")}
							</Text>
						</View>
					</View>

					<View style={styles.chipRow}>
						{/* 価格帯（budgetIntent が選択されている場合のみ） */}
						{deriveBudgetIntentFromPriceLevels(params.priceLevels)?.map((budgetIntent) => {
							const priceOption = priceLevelOptions.find((option) => option.budgetIntent === budgetIntent);
							if (!priceOption) return null;
							return (
								<View key={budgetIntent} style={styles.conditionChip}>
									<DollarSign size={14} color="#f05537" />
									<Text style={styles.conditionChipText}>{i18n.t(priceOption.label)}</Text>
								</View>
							);
						})}

						{/* 食事にかける時間（diningPace が選択されている場合のみ） */}
						{params.diningPace && (
							<View style={styles.conditionChip}>
								<Timer size={14} color="#f05537" />
								<Text style={styles.conditionChipText}>
									{i18n.t(diningPaceOptions.find((option) => option.id === params.diningPace)?.label || "")}
								</Text>
							</View>
						)}

						{/* 味の好み（taste が選択されている場合のみ） */}
						{params.taste && (
							<View style={styles.conditionChip}>
								<ChefHat size={14} color="#f05537" />
								<Text style={styles.conditionChipText}>
									{i18n.t(tasteOptions.find((t) => t.id === params.taste)?.label || "")}
								</Text>
							</View>
						)}

						{/* 中核食材・主食系（coreIngredient が選択されている場合のみ） */}
						{params.coreIngredient && (
							<View style={styles.conditionChip}>
								<ChefHat size={14} color="#f05537" />
								<Text style={styles.conditionChipText}>
									{i18n.t(coreIngredientOptions.find((option) => option.id === params.coreIngredient)?.label || "")}
								</Text>
							</View>
						)}
					</View>
				</View>
			)}

			{/* #674 【仕様】サブコピー */}
			<Text style={styles.subCopy}>{i18n.t("Topics.subCopy")}</Text>

			{/* 中央のメイン領域（カルーセル＋サムネイル） */}
			<View style={styles.main}>
				{/* 空き高さを onLayout で測って、カルーセル高さを決定 */}
				<View
					style={styles.carouselOuter}
					onLayout={(e) => {
						setCarouselAvailableHeight(e.nativeEvent.layout.height);
					}}>
					{visibleTopics.length > 0 ? (
						cardHeight > 0 && (
							<View style={styles.carouselContainer}>
								<Carousel
									ref={carouselRef}
									width={CARD_WIDTH}
									height={cardHeight + TOPIC_CARD_CTA_OVERHANG}
									data={visibleTopics}
									renderItem={renderCard}
									onSnapToItem={handleSnapToItem}
									onScrollStart={() => setIsScrolling(true)}
									onScrollEnd={() => setIsScrolling(false)}
									mode="parallax"
									modeConfig={{
										parallaxScrollingScale: 0.9,
										parallaxScrollingOffset: 100,
									}}
									style={styles.carousel}
								/>
							</View>
						)
					) : (
						<View style={styles.emptyContainer}></View>
					)}
				</View>

				{/* ✅ 下部サムネイル：absolute ではなく通常フローの一番下 */}
				{visibleTopics.length > 0 && (
					<View style={styles.thumbnailGrid}>
						{visibleTopics.map((topic, index) => (
							<TouchableOpacity
								key={topic.categoryId}
								style={[styles.thumbnail, currentIndex === index && styles.thumbnailActive]}
								onPress={() => handleThumbnailPress(index)}
								activeOpacity={0.7}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("Topics.accessibility.thumbnail", {
									title: topic.topicTitle,
									index: index + 1,
									total: visibleTopics.length,
								})}
								accessibilityState={{ selected: currentIndex === index }}>
								<Image
									source={{ uri: topic.imageUrl, headers: WIKIMEDIA_HEADERS }}
									style={styles.thumbnailImage}
									contentFit="cover"
									cachePolicy="memory"
									// #937 【仕様】親 TouchableOpacity 側で読み上げるため、画像自体は装飾扱いにする
									alt=""
									accessibilityElementsHidden
									importantForAccessibility="no"
								/>
							</TouchableOpacity>
						))}
					</View>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
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
		backgroundColor: "#FDEBE7",
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 24,
		gap: 4,
	},
	conditionChipText: {
		fontSize: 13,
		color: "#f05537",
		fontWeight: "500",
	},
	subCopy: {
		fontSize: 14,
		color: "#6B7280",
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
		backgroundColor: "#F05537",
		paddingHorizontal: 24,
		paddingVertical: 16,
		borderRadius: 16,
		shadowColor: "#F05537",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
	retryButtonText: {
		fontSize: 16,
		color: "#FFFFFF",
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
	carousel: {
		width: SCREEN_WIDTH,
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	emptyCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.12,
		shadowRadius: 24,
		elevation: 8,
		width: "100%",
		maxWidth: 320,
	},
	emptyText: {
		fontSize: 18,
		color: "#6B7280",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 28,
		fontWeight: "500",
	},
	// 下部サムネイル（通常フローで一番下）
	thumbnailGrid: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "center",
		gap: 8,
	},
	thumbnail: {
		width: (SCREEN_WIDTH - 72) / 6, // 画面幅から余白を引いて3等分
		aspectRatio: 1, // 正方形
		borderRadius: 12,
		overflow: "hidden",
		borderWidth: 2,
		borderColor: "#C9C9C9",
		shadowColor: "#C9C9C9",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	thumbnailActive: {
		borderColor: "#f05537",
		shadowColor: "#f05537",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 4,
	},
	thumbnailImage: {
		width: "100%",
		height: "100%",
	},
});
