import React, { useCallback, useEffect, useState } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { useRestaurantStore, type RestaurantEntry } from "@/stores/useRestaurantStore";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantByIdResponse, DishMediaEntry } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocale } from "@/hooks/useLocale";
import { bumpMyDishesRevision } from "@/features/myDishes/stores/useMyDishesRevisionStore";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

export default function ReviewScreen() {
	const styles = useThemedStyles(createStyles);
	const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
	const { lightImpact } = useHaptics();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restaurant, setRestaurant] = useState<RestaurantEntry | undefined>(undefined);

	// #644 【設計】レビュー投稿成功時に /post/:id に遷移
	// #1127 【修正】ReviewForm へ渡すコールバックは必ず参照を安定させること。
	// ReviewForm はマウント時にメディア選択を走らせており、毎レンダー新しい関数を渡すと
	// （ReviewForm 側の ref 化が失われた場合に）effect が張り替わって選択結果が捨てられる。多層防御。
	const handleReviewSuccess = useCallback(
		({ dishMedia, dishReviewId }: { dishMedia: DishMediaEntry["dish_media"] | null; dishReviewId: string }) => {
			// #1398 (PR4/7) 設計 §3「唯一の実務上の落とし穴：クライアントキャッシュ」。
			// サーバ側は want 枝の `NOT EXISTS (SELECT 1 FROM dish_reviews …)` で正しく畳むが、
			// クライアントが取り直さないと **記録した直後の一覧に「食べたい」カードが残って見える**。
			// ここでキャッシュを捨てる（`bump` が `clearQuery()` を呼ぶ）。
			// ⚠️ `ReviewForm` 側には置かない。ReviewForm を my-dishes に結合させないため（設計 §3）
			bumpMyDishesRevision();
			// /my-dishes までスタックを掃除（なければ現在画面を /my-dishes に置き換え）
			router.dismissTo(`/${locale}/(tabs)/my-dishes`);
			/**
			 * #1398 (c-2) 【設計】写真なしで記録したときは `/post/[id]` へ遷移しない。
			 *
			 * `/post/[id]` は `useDishMediaEntriesStore` にエントリがあることを前提に描いている。
			 * 写真なしの記録は R2（不正なエントリで全画面 Feed が壊れるのを避ける）によって
			 * ストアを 1 つも触らないため、遷移するとローディングのまま固着する。
			 *
			 * #1441 M-2 【レビュー対応】記録自体は成功しているが、遷移先 `/my-dishes` の一覧の実体は
			 * まだ無い（#1396 PR3〜PR5 の担当）。記録成功時の一覧無効化（revision bump）も
			 * #1398 PR4 の担当なので、本 PR（PR2）単体では「食べた」として一覧に現れることを
			 * この画面で確認する手段は無い。積み上げ PR として仕様どおりであり、バグではない。
			 */
			if (!dishMedia) return;
			router.push({
				pathname: `/[locale]/post/[id]`,
				params: {
					locale,
					id: dishReviewId,
				},
			});
		},
		[locale],
	);

	// #1127 同上。インライン生成（`onCancel={() => router.back()}`）は親の再レンダーごとに identity が変わる
	const handleReviewCancel = useCallback(() => {
		router.back();
	}, []);

	// #644 【設計】restaurant.id でレストラン詳細を取得（ストアキャッシュ優先）
	useEffect(() => {
		if (!restaurantId) return;

		// まずストアから取得し、あればそれを使う
		const { getById, upsert } = useRestaurantStore.getState();
		const cached = getById(restaurantId);
		if (cached) {
			setRestaurant(cached);
			return;
		}

		// キャッシュがない場合は最新情報を取得して更新
		const fetchRestaurant = async () => {
			setIsLoading(true);

			try {
				const response = await callBackend<Record<string, never>, GetRestaurantByIdResponse>(
					`v1/restaurants/${restaurantId}`,
					{
						method: "GET",
						requestPayload: {},
					},
				);

				const entry: RestaurantEntry = {
					restaurant: response.restaurant,
					meta: response.meta,
				};

				// ストアに保存
				upsert(entry);
				setRestaurant(entry);
				setError(null);

				logFrontendEvent({
					event_name: "review_screen_restaurant_loaded",
					error_level: "log",
					payload: { restaurantId, fromCache: !!cached },
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to load restaurant";
				setError(errorMessage);
				showSnackbar(i18n.t("Common.errors.unexpected"));

				logFrontendEvent({
					event_name: "review_screen_load_error",
					error_level: "error",
					payload: { restaurantId, error: errorMessage },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchRestaurant();
	}, [restaurantId, callBackend, showSnackbar, logFrontendEvent]);

	// #644 【設計】ローディング表示（キャッシュがない場合のみ）
	if (isLoading && !restaurant) {
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

	// #644 【設計】エラー表示（レストランが見つからない場合など）
	if (error && !restaurant) {
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

	if (!restaurant) {
		return null;
	}

	return (
		<View style={styles.container}>
			<ScreenHeader
				title={i18n.t("Restaurant.review.title")}
				onPressBack={() => {
					lightImpact();
					router.back();
				}}
			/>

			{/*
				#644 【設計】ReviewForm をメディア選択ありモードで表示
				#1398 B2/B3 【設計】この経路だけ写真なしを許可する（`allowNoMedia`）。
				着地時にピッカーが自動で開くのは従来どおりで、キャンセルすると画面が閉じる代わりに
				「写真を追加」プレースホルダの付いたフォームへ留まる。退出は上の ScreenHeader の戻るで行う。
				`review-from-media` 経路は allowNoMedia を渡さないので挙動が変わらない
			*/}
			<ReviewForm
				restaurant={restaurant.restaurant}
				allowNoMedia
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
