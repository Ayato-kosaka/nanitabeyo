import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { useRestaurantStore, type RestaurantEntry } from "@/stores/useRestaurantStore";
import {
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantByIdResponse, QueryDishMediaByIdsResponse, DishMediaEntry } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocale } from "@/hooks/useLocale";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import { MY_DISHES_EVENTS, buildMarkAsEatenCompletedPayload } from "@/features/myDishes/analytics";
import { takeMarkAsEaten } from "@/features/myDishes/markAsEatenFunnel";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

export default function ReviewFromMediaScreen() {
	const styles = useThemedStyles(createStyles);
	const { restaurantId, dishMediaId } = useLocalSearchParams<{ restaurantId: string; dishMediaId: string }>();
	const { lightImpact } = useHaptics();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restaurantEntry, setRestaurantEntry] = useState<RestaurantEntry | undefined>(undefined);
	const [dishMedia, setDishMedia] = useState<NormalizedDishMediaEntry | null>(null);

	// #644 【設計】レビュー投稿成功時に /post/:id に遷移
	// #1127 【修正】ReviewForm へ渡すコールバックは参照を安定させる（review.tsx と同じ多層防御）
	const handleReviewSuccess = useCallback(
		({ dishReviewId }: { dishReviewId: string }) => {
			// #1403 (PR2) 「保存 → 食べた」の **出口**。入口（`my_dishes_mark_as_eaten_pressed`）と
			// 対になる完了イベントをここで 1 回だけ出す。
			//
			// ⚠️ 無条件に出さないこと。このルートは my-dishes 以外（フィードの「この料理にレビューを
			// 書く」・店舗詳細のレビューグリッド）からも入ってくる共有ルートで、無条件に出すと
			// my-dishes を開いてすらいない投稿まで「保存→食べた の完了」に数えてしまう。
			// `takeMarkAsEaten` は «直前に my-dishes から押した» 意図が、同じ dishMediaId で、
			// TTL 内にあるときだけ返す（take-once）。返らなければ何も出さない = 取りこぼす側に倒す
			const intent = takeMarkAsEaten(dishMediaId);
			if (intent !== null) {
				logFrontendEvent({
					event_name: MY_DISHES_EVENTS.markAsEatenCompleted,
					error_level: "log",
					payload: buildMarkAsEatenCompletedPayload({
						from: intent.from,
						itemKey: intent.itemKey,
						restaurantId: intent.restaurantId,
						dishMediaId: intent.dishMediaId,
						dishReviewId,
						durationMs: Date.now() - intent.startedAt,
					}),
				});
			}
			// #1398 (PR4/7) 設計 §3「唯一の実務上の落とし穴：クライアントキャッシュ」。
			// サーバ側は want 枝の `NOT EXISTS (SELECT 1 FROM dish_reviews …)` で正しく畳むが、
			// クライアントが取り直さないと **記録した直後の一覧に「食べたい」カードが残って見える**。
			// ここでキャッシュを捨てる（`bump` が `clearQuery()` を呼ぶ）。
			// ⚠️ `ReviewForm` 側には置かない。ReviewForm を my-dishes に結合させないため（設計 §3）
			bumpMyDishesRevision();
			// /my-dishes までスタックを掃除（なければ現在画面を /my-dishes に置き換え）
			router.dismissTo(`/${locale}/(tabs)/my-dishes`);
			router.push({
				pathname: `/[locale]/post/[id]`,
				params: {
					locale,
					id: dishReviewId,
				},
			});
		},
		// `logFrontendEvent` は `useCallback(..., [])` で参照が固定されているので、
		// #1127 が求める «このコールバックの参照を安定させる» 条件は崩れない
		[dishMediaId, locale, logFrontendEvent],
	);

	// #1127 同上
	const handleReviewCancel = useCallback(() => {
		router.back();
	}, []);

	// #644 【設計】restaurant.id と dishMediaId でデータを取得
	useEffect(() => {
		if (!restaurantId || !dishMediaId) return;

		// Restaurant 情報取得（ストアキャッシュ優先）
		const { getById, upsert } = useRestaurantStore.getState();
		const restaurantCached = getById(restaurantId);

		// DishMedia 情報取得（ストアキャッシュ優先）
		const dishMediaEntriesStore = useDishMediaEntriesStore.getState();
		const mediaEntryCached = selectEntryByMediaId(dishMediaId)(dishMediaEntriesStore);
		if (restaurantCached && mediaEntryCached) {
			// 両方キャッシュがあれば即座に表示
			setRestaurantEntry(restaurantCached);
			setDishMedia(mediaEntryCached);
			return;
		}

		// キャッシュがない場合は最新情報を取得して更新
		const fetchData = async () => {
			setIsLoading(true);

			try {
				// restaurant 情報取得
				const restaurantEntry = await callBackend<Record<string, never>, GetRestaurantByIdResponse>(
					`v1/restaurants/${restaurantId}`,
					{
						method: "GET",
						requestPayload: {},
					},
				).then((response) => ({
					restaurant: response.restaurant,
					meta: response.meta,
				}));
				upsert(restaurantEntry);
				setRestaurantEntry(restaurantEntry);

				// dishMedia 情報取得
				const dishMediaEntries = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>(
					"v1/dish-media",
					{
						method: "GET",
						requestPayload: { ids: [dishMediaId] },
					},
				).then((response) => response.items);
				dishMediaEntriesStore.upsertDishMediaEntries(dishMediaEntries);
				const normalizedEntry = selectEntryByMediaId(dishMediaId)(useDishMediaEntriesStore.getState());
				setDishMedia(normalizedEntry);

				setError(null);

				logFrontendEvent({
					event_name: "review_from_media_screen_loaded",
					error_level: "log",
					payload: { restaurantId, dishMediaId },
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to load data";
				setError(errorMessage);
				showSnackbar(i18n.t("Common.errors.unexpected"));

				logFrontendEvent({
					event_name: "review_from_media_screen_load_error",
					error_level: "error",
					payload: { restaurantId, dishMediaId, error: errorMessage },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [restaurantId, dishMediaId, callBackend, showSnackbar, logFrontendEvent]);

	// #1127 【修正】ReviewForm へ渡す prefilledMedia の参照を安定させる（FeedDishMediaViewer.tsx と同じ形）。
	// インラインのオブジェクトリテラルのままだと、この画面が再レンダーするたびに identity が変わり、
	// ReviewForm 側のプレビュー用 effect が張り替わってプレビューがスピナーへ点滅する。
	// この画面は useAPICall() → useAuth() で AuthContext を購読しているため、再レンダーは頻繁に起きる。
	// early return より前で宣言すること（Hooks の呼び出し順を固定するため）。
	const prefilledMedia = useMemo(
		() => (dishMedia ? { ...dishMedia.dish_media, dish: dishMedia.dish } : undefined),
		[dishMedia],
	);

	// #644 【設計】ローディング表示
	if (isLoading) {
		return (
			<View style={styles.container}>
				<ScreenHeader
					title={i18n.t("Restaurant.review.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="large" />
				</View>
			</View>
		);
	}

	// #644 【設計】エラー表示
	if (error || !restaurantEntry || !dishMedia) {
		return (
			<View style={styles.container}>
				<ScreenHeader
					title={i18n.t("Restaurant.review.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<ScreenHeader
				title={restaurantEntry.restaurant.name}
				onPressBack={() => {
					lightImpact();
					router.back();
				}}
			/>

			{/* #644 【設計】ReviewForm を既存メディア利用モード（prefilledMedia）で表示 */}
			<ReviewForm
				restaurant={restaurantEntry.restaurant}
				prefilledMedia={prefilledMedia}
				onCancel={handleReviewCancel}
				onSuccess={handleReviewSuccess}
			/>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		loadingContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		errorContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			padding: 16,
		},
		errorText: {
			fontSize: 16,
			color: c.textMuted,
			textAlign: "center",
		},
	});
