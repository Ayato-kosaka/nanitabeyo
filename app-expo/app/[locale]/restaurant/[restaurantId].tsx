import React, { useCallback, useEffect, useState } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SelectedRestaurantDetails } from "@/features/restaurant/components/SelectedRestaurantDetails";
import { useRestaurantStore, type RestaurantEntry } from "@/stores/useRestaurantStore";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantByIdResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocale } from "@/hooks/useLocale";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

/*
 * 店舗詳細画面（アプリ唯一の店舗詳細）
 * - レストランの詳細情報を表示
 * - 「写真・動画を投稿」ボタンでメディア選択モードでレビュー投稿画面へ遷移
 * - 「入札する」で入札画面へ遷移
 * - レストランのレビュー（料理メディア）押下でフィード画面へ遷移
 *
 * #1386 【設計】この画面は «レビュー投稿導線の一部» から «店舗詳細そのもの» になった。
 * 以前は地図タブ（#1419 で削除）が `RestaurantBlurModal` の中に
 * 別実装の店舗詳細（353 行）を持っており、同じ画面が 2 つあった。統合の詳細は
 * `features/restaurant/components/SelectedRestaurantDetails.tsx` の冒頭コメントを参照。
 *
 * 到達経路は 3 つ: 店舗選択（レビュー投稿）/ 地図のマーカー・POI・場所検索 / URL 直リンク。
 * どれも `restaurantId` だけで成立する（実体はストアのキャッシュ優先で、無ければ API を引く）。
 */
export default function RestaurantDetailScreen() {
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

	/**
	 * #1386 【設計】戻る導線。履歴があれば back（出発点の地図・店舗選択がマウントされたまま
	 * 残っているので、URL に出ていない画面内 state ごと復帰できる）。
	 * 履歴が無い着地（URL 直リンク / リロード / UI カタログの直遷移）だけが例外で、そこは
	 * 戻る先が存在しないため `router.back()` が «何も起きない行き止まり» になる。
	 * #1396 【設計】倒す先はレビュータブから my-dishes タブへ差し替わった
	 * （この画面が置かれているスタックの根がそこだから）。
	 */
	const handleBack = useCallback(() => {
		lightImpact();
		if (router.canDismiss()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/my-dishes", params: { locale } });
	}, [lightImpact, locale]);

	// #644 【設計】restaurant.id でレストラン詳細を取得（ストアキャッシュ優先）
	useEffect(() => {
		if (!restaurantId) return;

		// まずストアから取得し、あればそれを使う
		const cached = useRestaurantStore.getState().getById(restaurantId);
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
				const { upsert } = useRestaurantStore.getState();
				upsert(entry);
				setRestaurant(entry);
				setError(null);

				logFrontendEvent({
					event_name: "restaurant_detail_loaded",
					error_level: "log",
					payload: { restaurantId, fromCache: !!cached },
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to load restaurant";
				setError(errorMessage);
				showSnackbar(i18n.t("Common.errors.unexpected"));

				logFrontendEvent({
					event_name: "restaurant_detail_load_error",
					error_level: "error",
					payload: { restaurantId, error: errorMessage },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchRestaurant();
	}, [restaurantId, callBackend, showSnackbar, logFrontendEvent]);

	// #1386 【設計】ヘッダーは «データの分岐の外» に 1 つだけ置く。
	//
	// 分岐ごとに ScreenHeader を書くと、戻る導線と観測点が取得結果に依存してしまう。
	// 実際 #1388 のレビューで、loading / error 分岐にだけ testID が無く、
	// e2e-mobile が「存在しない id で直リンクして器を見る」戦略（API モックが無いため
	// そうするしかない。screens/RestaurantDetailScreen.ts 参照）を取れなくなっていた。
	// 404 でも「戻れること」と「ここが店詳細ルートであること」は成り立つべきなので、
	// ヘッダーを括り出して本文だけを差し替える。
	//
	// testID は e2e（web: pages/RestaurantDetailPage.ts / mobile: screens/RestaurantDetailScreen.ts）が
	// 「ルートであること」を見るために使う。ScreenHeader は `${testID}-title` をタイトルへ付ける
	return (
		<View style={styles.container}>
			<ScreenHeader
				title={i18n.t("Restaurant.detail.title")}
				onPressBack={handleBack}
				testID="restaurant-detail-screen"
			/>

			{/* #644 【設計】ローディング表示（キャッシュがない場合のみ） */}
			{isLoading && !restaurant ? (
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="large" />
				</View>
			) : /* #644 【設計】エラー表示（レストランが見つからない場合など） */
			error && !restaurant ? (
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			) : restaurant ? (
				<SelectedRestaurantDetails restaurantEntry={restaurant} />
			) : null}
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
