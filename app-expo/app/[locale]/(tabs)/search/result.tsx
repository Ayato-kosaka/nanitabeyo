import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { X, Share2 } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import {
	DishMediaEntriesStore,
	selectEntryByMediaId,
	selectIdsByKey,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";
import { DishSelectionExpandLoading } from "@/features/dishMedia/components/DishSelectionExpandLoading";
import { useDishMediaActions } from "@/features/dishMedia/hooks/useDishMediaActions";
import i18n from "@/lib/i18n";
import { useLocale } from "@/hooks/useLocale";
import { useGoogleMapsFallback } from "@/features/search/hooks/useGoogleMapsFallback";
import { FixedColors } from "@/constants/Palette";
import { useAppTheme } from "@/contexts/ThemeProvider";

const idType = "dish_media" as const;

export default function ResultScreen() {
	// #633 【設計】dishCategoryId ではなく entriesKey を使用（DishCategories/SavedDishCategories 共通化）
	const { entriesKey, location, category, dishImageUrl } = useLocalSearchParams<{
		entriesKey: string;
		location?: string;
		category?: string;
		// #1484 【設計】DishCategories 画面の「この料理にする！」経由の場合のみ渡される。選択した料理画像を
		// 店舗提案の取得完了まで表示し続けるためのローディング演出に使う（無ければ従来のローディングにfallback）。
		dishImageUrl?: string;
	}>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { shareRestaurant } = useDishMediaActions({ source: "search_result_screen" });
	const { locale } = useLocale();
	const { showGoogleMapsFallbackDialog } = useGoogleMapsFallback({ source: "search_result_screen" });
	const shownGoogleMapsFallbackKeyRef = useRef<string | null>(null);
	// #1629 画面の地がライト固定のグラデーション直書きだったのでテーマのトークンへ移した
	const { colors } = useAppTheme();

	// #633 【防御】entriesKey が undefined の場合は戻る（クラッシュ防止）
	useEffect(() => {
		if (!entriesKey) {
			logFrontendEvent({
				event_name: "result_screen_invalid_entrieskey",
				error_level: "error",
				payload: { entriesKey, location },
			});
			router.back();
		}
	}, [entriesKey, location, logFrontendEvent]);

	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey || "", idType)(state),
		// `idType` はモジュール定数（26 行目）なので依存に含めない
		[entriesKey],
	);
	const { ids, isLoading } = useDishMediaEntriesStore(selector, shallow);
	const initialLocation = useMemo(() => {
		if (typeof location === "string") {
			try {
				return JSON.parse(location) as { latitude: number; longitude: number };
			} catch {
				return undefined;
			}
		}
		return undefined;
	}, [location]);

	const { currentIndex, showCompletionModal, handleIndexChange, handleClose, handleReturnToCards } = useSearchResult(
		entriesKey || "",
	);

	useEffect(() => {
		// Log screen view with search parameters
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: {
				screen: "search_result",
				entriesKey, // #633 【設計】entriesKey をログに記録
				hasEntriesKey: !!entriesKey,
			},
		});
	}, [entriesKey, logFrontendEvent]);

	useEffect(() => {
		// #828 【設計】0件確定後の退避導線は、取得元ではなく検索結果画面の責務として扱う。
		if (!entriesKey || isLoading || ids.length > 0 || !initialLocation || !category) return;

		// 同じ0件結果の再レンダーでは重複表示せず、新しい検索条件では再度 fallback を出す。
		const fallbackKey = `${entriesKey}:${category}:${typeof location === "string" ? location : ""}`;
		if (shownGoogleMapsFallbackKeyRef.current === fallbackKey) return;
		shownGoogleMapsFallbackKeyRef.current = fallbackKey;

		showGoogleMapsFallbackDialog({
			entriesKey,
			category,
			location: initialLocation,
			locale,
		});

		// #828 【設計】表示できる店舗がない場合、料理候補画面へ戻す。
		// iOS で、react-native-paper の Portal.Host が transparentModal より下にあるため、この位置。
		handleClose();
	}, [
		category,
		entriesKey,
		ids.length,
		initialLocation,
		isLoading,
		locale,
		location,
		handleClose,
		showGoogleMapsFallbackDialog,
	]);

	const handleCloseWithHaptic = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "search_result_closed",
			error_level: "log",
			payload: { entriesKey, currentIndex }, // #633 【設計】entriesKey をログに記録
		});
		handleClose();
	};

	// #659 【機能】一括シェアボタン処理 - アクティブメディアを先頭にシェア
	const handleBulkShare = useCallback(async () => {
		lightImpact();

		if (!entriesKey) return;

		// #659 【設計】ストアをサブスクリプションせず、getState() で単発読み取り
		const state = useDishMediaEntriesStore.getState();
		const { ids } = selectIdsByKey(entriesKey, idType)(state);

		if (!ids || ids.length === 0) return;

		// #659 【防御】currentIndex の安全な取得と範囲チェック
		const index = Number.isFinite(currentIndex) ? currentIndex : 0;
		const safeIndex = Math.min(Math.max(index, 0), ids.length - 1);
		const dishMediaId = ids[safeIndex];

		// #659 【設計】アクティブメディアを先頭に並び替えたID配列を作成
		const targetIds = [...ids.slice(safeIndex), ...ids.slice(0, safeIndex)];
		if (targetIds.length === 0) return;

		const restaurant = selectEntryByMediaId(dishMediaId)(state)?.restaurant;
		if (!restaurant) return;

		// #659 【ログ】一括シェアイベント記録
		logFrontendEvent({
			event_name: "search_result_bulk_share",
			error_level: "log",
			payload: {
				entriesKey,
				currentIndex,
				shared_ids: targetIds,
			},
		});

		// #659 【設計】shareRestaurant に idsForShare を渡して一括シェア実行
		return shareRestaurant({
			dishMediaId,
			restaurant,
			idsForShare: targetIds,
		});
	}, [entriesKey, currentIndex, lightImpact, logFrontendEvent, shareRestaurant]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			{/* Header with Back Button */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity
					testID="result-close-button"
					style={styles.closeButton}
					onPress={handleCloseWithHaptic}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.close")}>
					{/* この 2 つのボタンは全画面の Google Map タイルの上に直接載る。地図はアプリのテーマに
					    追従せず常にライト配色なので、ボタンの地と字も地図用の固定色にする（ダークで暗くすると
					    明るい地図の上で沈んで押せる場所が分からなくなる） */}
					<X size={24} color={FixedColors.mapMarkerLabel} />
				</TouchableOpacity>
				{/* #659 【UI】一括シェアボタン - 閉じるボタンの直下に配置 */}
				<TouchableOpacity
					style={styles.shareButton}
					onPress={handleBulkShare}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Search.result.accessibility.bulkShare")}>
					<Share2 size={24} color={FixedColors.mapMarkerLabel} />
				</TouchableOpacity>
			</View>

			{/* Feed Content */}
			{/* <DishMediaFeed items={dishes} onIndexChange={handleIndexChange} /> */}
			<DishMediaMap
				onIndexChange={handleIndexChange}
				initialLocation={initialLocation}
				entriesKey={entriesKey || ""} // #633 【設計】entriesKey を使用（防御的に空文字列を渡す）
				idType={idType}
			/>

			{/* #420 【仕様】店舗5件のローディング画面 - 必要データ（リスト＋サムネイル最低1枚）事前読み込み未完了の場合のみ表示 */}
			{/* #633 【防御】entriesKey が undefined の場合も loading を表示（戻る処理中） */}
			{/* #1484 【仕様】DishCategories画面の「この料理にする！」経由（dishImageUrlあり）は、独立ローディング画面の
			    代わりに選択した料理画像を拡大表示したまま待たせる。それ以外の経路は従来のRestaurantLoadingを維持する。 */}
			{(isLoading || !entriesKey) &&
				(dishImageUrl ? (
					<View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="auto">
						<DishSelectionExpandLoading imageUrl={dishImageUrl} />
					</View>
				) : (
					<View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="auto">
						<RestaurantLoading />
					</View>
				))}
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	closeButtonContainer: {
		position: "absolute",
		right: 0,
		flexDirection: "column", // #659 【UI】縦並びに変更（閉じるボタンとシェアボタン）
		alignItems: "center",
		justifyContent: "flex-start",
		padding: 16,
		zIndex: 10,
	},
	// 地の白は「常にライト配色の地図タイルの上に載るボタン」ゆえの固定色（上の JSX のコメント参照）
	closeButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: FixedColors.mapMarkerSurface,
		shadowColor: FixedColors.shadow,
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
	// #659 【UI】一括シェアボタンスタイル - closeButton と同じデザイン
	shareButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: FixedColors.mapMarkerSurface,
		shadowColor: FixedColors.shadow,
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
		marginTop: 8, // #659 【UI】閉じるボタンとの間隔
	},
});
