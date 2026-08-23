/*
このファイルの責務
- 店詳細のレビュー一覧（グリッド）から開くフィードを «画面» として提供する。
- 表示開始位置（`initialIndex`）を URL パラメータで受け取る。
- ストアにエントリが無い着地（URL 直リンク / リロード）では自分で初回読み込みを行う。
- 閉じる導線（× / ハードウェアバック / ブラウザバック）で店詳細へ帰す。

#1386 【設計】以前は `RestaurantReviewsTab` の中の `DishMediaModal`（BlurModal・**既定 zIndex 1100**）
だった。親の店詳細シートも 1100 だったので «同値のまま同じ Portal ホストに重なる» 状態で、
#308（レストランのレビューが出ない = pointerEvents / 重なり）の当事者そのものである。

`app/[locale]/(tabs)/notifications/feed.tsx` / `app/[locale]/(tabs)/profile/food.tsx` と同じく
フィードはルートで表現する。presentation は指定しない（＝既定の card）ので、Android の戻る・
ブラウザバック・URL 共有はすべて Navigator の既定挙動で賄える。

⚠️ 閉じる × は `search/result.tsx` と同じ «絶対配置 + zIndex 10» で置いてある。
ScreenHeader を載せないのは、フィードが全画面のメディアで、上端にバーを敷くと
1 枚あたりの表示領域が縮むため（既存のフィード 2 画面と同じ判断）。
*/
import React, { useCallback, useEffect, useMemo } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors } from "@/constants/Palette";
import { FeedDishMediaViewer } from "@/features/map/components/FeedDishMediaViewer";
import { mapReviewsKey } from "@/features/map/constants";
import { useRestaurantDishMediaFetcher } from "@/features/map/hooks/useRestaurantDishMediaFetcher";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";

export default function RestaurantFeedScreen() {
	const { restaurantId, initialIndex } = useLocalSearchParams<{ restaurantId: string; initialIndex?: string }>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const startIndex = initialIndex ? parseInt(String(initialIndex), 10) : 0;

	// #1386 レビュータブと同じ画面用途キー。タブが先に読んでいればそのまま使える
	const entriesKey = useMemo(() => mapReviewsKey(restaurantId), [restaurantId]);
	const fetchInitialByKey = useDishMediaEntriesStore((s) => s.fetchInitialByKey);
	const { ids, isLoading, hasFetchedInitial, error } = useDishMediaEntriesStore(
		selectIdsByKey(entriesKey, "dish_media"),
		shallow,
	);
	const fetcher = useRestaurantDishMediaFetcher(restaurantId);

	// #1386 【設計】ストアが空のときだけ引く。店詳細から来た通常導線ではレビュータブが
	// 既に読み込んでおり（キーが同じ）、ここで引き直すと同じページを 2 回叩くことになる。
	// ⚠️ `clearByKey` はレビュータブの unmount で走る。店詳細はスタックに残るため、
	// このフィードが開いている間にキーが消えることはない。
	// ⚠️ `!error` を必ず条件へ入れること。取得が失敗したときストアは
	// `hasFetchedInitial` を false のまま `isLoading` を false へ戻すので（stores/useDishMediaEntriesStore.ts
	// の handleAsyncAction）、error を見ないと **失敗するたびに再取得して無限ループする**
	useEffect(() => {
		if (restaurantId && !hasFetchedInitial && !isLoading && !error) {
			fetchInitialByKey(entriesKey, {}, fetcher);
		}
	}, [restaurantId, entriesKey, fetchInitialByKey, fetcher, hasFetchedInitial, isLoading, error]);

	const handleClose = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "restaurant_feed_closed",
			error_level: "log",
			payload: { restaurantId, canDismiss: router.canDismiss() },
		});

		if (router.canDismiss()) {
			router.back();
			return;
		}
		// 履歴が無い着地（URL 直リンク / リロード）の保険。出発点は店詳細だけ
		router.replace({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale, restaurantId },
		});
	}, [lightImpact, logFrontendEvent, locale, restaurantId]);

	return (
		<View style={styles.container} testID="restaurant-feed-screen">
			{/* ⚠️ 閉じる導線は «下の分岐の外» に置くこと。ここで詰まると戻る手段が無くなる */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity
					testID="restaurant-feed-close-button"
					style={styles.closeButton}
					onPress={handleClose}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.close")}>
					<X size={24} color={FixedColors.onMedia} />
				</TouchableOpacity>
			</View>

			{ids.length > 0 ? (
				<FeedDishMediaViewer
					initialIndex={isNaN(startIndex) ? 0 : startIndex}
					entriesKey={entriesKey}
					restaurantId={restaurantId}
				/>
			) : isLoading || (!hasFetchedInitial && !error) ? (
				<View style={styles.centered} testID="restaurant-feed-loading">
					<LoadingIndicator size="large" />
				</View>
			) : (
				/* 取得できたが 0 件 / 取得に失敗した、のどちらも «見るものが無い» なので同じ表示にする。
				   ⚠️ ここを loading へ倒さないこと。失敗時は hasFetchedInitial が false のままなので、
				   error を見ないとスピナーで固着する */
				<View style={styles.centered} testID="restaurant-feed-empty">
					<Text style={styles.emptyText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			)}
		</View>
	);
}

// 全画面フィードの黒地と、その上の白文字・白アイコンはテーマで振らない固定色（constants/Palette.ts の FixedColors）
const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: FixedColors.mediaBackground,
	},
	centered: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
	},
	emptyText: {
		fontSize: 16,
		color: FixedColors.onMedia,
		textAlign: "center",
	},
	// search/result.tsx と同じ形（フィードの上に浮かせる）
	closeButtonContainer: {
		position: "absolute",
		right: 16,
		zIndex: 10,
	},
	closeButton: {
		padding: 12,
	},
});
