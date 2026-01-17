import React, { useCallback, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Share } from "react-native";
import { X, Share2 } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { DishMediaEntriesStore, selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";

const idType = "dish_media" as const;
export default function ResultScreen() {
	// #633 【設計】topicId ではなく entriesKey を使用（Topics/SavedTopics 共通化）
	const { entriesKey, location } = useLocalSearchParams<{ entriesKey: string; location?: string }>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

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
	const { isLoading } = useDishMediaEntriesStore(selector, shallow);
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

	const handleCloseWithHaptic = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "search_result_closed",
			error_level: "log",
			payload: { entriesKey, currentIndex }, // #633 【設計】entriesKey をログに記録
		});
		handleClose();
	};

	// #659 【機能】一括シェアボタン処理 - アクティブメディアを先頭に最大5件をシェア
	const handleBulkShare = useCallback(async () => {
		if (!entriesKey) return;

		// #659 【設計】ストアをサブスクリプションせず、getState() で単発読み取り
		const state = useDishMediaEntriesStore.getState();
		const { ids } = selectIdsByKey(entriesKey, idType)(state);

		if (!ids || ids.length === 0) return;

		// #659 【防御】currentIndex の安全な取得と範囲チェック
		const index = Number.isFinite(currentIndex) ? currentIndex : 0;
		const safeIndex = Math.min(Math.max(index, 0), ids.length - 1);

		const maxShareCount = 5;
		const targetIds = ids.slice(safeIndex, safeIndex + maxShareCount);

		if (targetIds.length === 0) return;

		// #659 【設計】各IDをエンコードしてカンマ区切りで結合
		const idsParam = targetIds.map((id) => encodeURIComponent(id)).join(",");
		const url = `/posts?ids=${idsParam}`;

		// #659 【UX】ハプティクスフィードバック
		lightImpact();

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

		// #659 【機能】シェアシート表示
		await Share.share({ message: url });
	}, [entriesKey, currentIndex, lightImpact, logFrontendEvent]);

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
