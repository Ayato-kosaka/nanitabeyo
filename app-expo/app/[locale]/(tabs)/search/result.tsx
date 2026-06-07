import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, TouchableOpacity, Platform, Linking } from "react-native";
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
import { useDishMediaActions } from "@/features/dishMedia/hooks/useDishMediaActions";
import { useDialog } from "@/contexts/DialogProvider";
import i18n from "@/lib/i18n";
import { useLocale } from "@/hooks/useLocale";

const idType = "dish_media" as const;

export default function ResultScreen() {
	// #633 【設計】topicId ではなく entriesKey を使用（Topics/SavedTopics 共通化）
	const { entriesKey, location, category } = useLocalSearchParams<{
		entriesKey: string;
		location?: string;
		category?: string;
	}>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { shareRestaurant } = useDishMediaActions({ source: "search_result_screen" });
	const { showDialog } = useDialog();
	const { locale } = useLocale();

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
		[entriesKey, idType],
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

		const buildGoogleMapsSearchUrl = (
			category: string,
			location: {
				latitude: number;
				longitude: number;
			},
			options?: {
				zoom?: number;
				hl?: string;
			},
		) => {
			const zoom = options?.zoom ?? 14;
			const lat = Number(location.latitude.toFixed(7));
			const lng = Number(location.longitude.toFixed(7));
			const encodedCategory = encodeURIComponent(category);

			const url = new URL(`https://www.google.com/maps/search/${encodedCategory}/@${lat},${lng},${zoom}z`);

			if (options?.hl) {
				url.searchParams.set("hl", options.hl);
			}

			return url.toString();
		};

		// #828 【設計】アプリ側の検索カテゴリと表示言語に寄せ、Google Maps 側で同じ意図の検索を開く。
		const url = buildGoogleMapsSearchUrl(category, initialLocation, {
			hl: locale.split("-")[0],
		});

		logFrontendEvent({
			event_name: "google_maps_fallback_dialog_shown",
			error_level: "warn",
			payload: {
				entriesKey,
				category,
				latitude: initialLocation.latitude,
				longitude: initialLocation.longitude,
			},
		});

		showDialog(i18n.t("Search.googleMapsFallback.message"), {
			okLabel: i18n.t("Search.googleMapsFallback.confirm"),
			cancelLabel: i18n.t("Search.googleMapsFallback.cancel"),
			onConfirm: async () => {
				try {
					await Linking.openURL(url);
					logFrontendEvent({
						event_name: "google_maps_fallback_opened",
						error_level: "log",
						payload: {
							entriesKey,
							category,
							latitude: initialLocation.latitude,
							longitude: initialLocation.longitude,
						},
					});
				} catch (error) {
					logFrontendEvent({
						event_name: "google_maps_fallback_open_failed",
						error_level: "error",
						payload: {
							entriesKey,
							category,
							error_message: error instanceof Error ? error.message : String(error),
						},
					});
				}
			},
			onHide: (reason) => {
				if (reason !== "confirm") {
					logFrontendEvent({
						event_name: "google_maps_fallback_dismissed",
						error_level: "log",
						payload: {
							entriesKey,
							category,
							reason,
						},
					});
				}
			},
		});


		// #828 【設計】表示できる店舗がない場合、料理候補画面へ戻す。
		// iOS で、react-native-paper の Portal.Host が transparentModal より下にあるため、この位置。
		handleClose();
	}, [category, entriesKey, ids.length, initialLocation, isLoading, logFrontendEvent, showDialog, locale, handleClose]);

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
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity style={styles.closeButton} onPress={handleCloseWithHaptic}>
					<X size={24} color="#000" />
				</TouchableOpacity>
				{/* #659 【UI】一括シェアボタン - 閉じるボタンの直下に配置 */}
				<TouchableOpacity style={styles.shareButton} onPress={handleBulkShare}>
					<Share2 size={24} color="#000" />
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
			{(isLoading || !entriesKey) && (
				<View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="auto">
					<RestaurantLoading />
				</View>
			)}
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
	closeButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
	// #659 【UI】一括シェアボタンスタイル - closeButton と同じデザイン
	shareButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
		marginTop: 8, // #659 【UI】閉じるボタンとの間隔
	},
});
