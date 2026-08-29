import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { resolveDishCategoryLabel } from "@/features/myDishes/dishCategoryLabel";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import { toErrorLogString } from "@/lib/errorMessage";
import i18n from "@/lib/i18n";
import { asApiList } from "@/lib/apiList";
import type { DishMediaEntry, QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";

/**
 * #1375 実機確認（5 巡目）「③ は… その下に既存のディッシュメディアから選べるように配置」。
 *
 * ## なぜ «既存のメディアから選ぶ» が要るのか
 *
 * 「食べたを記録」で写真を持っていない人は今まで «写真なし» しか選べず、記録がのっぺりした
 * プレースホルダーになっていた。その店の料理写真は既にアプリの中にあるので、
 * **自分で撮っていなくても «その料理» の顔がある記録**にできる。
 * 選んだメディアの料理カテゴリーがそのまま記録の料理になる（`review-from-media` と同じ仕組み）。
 *
 * ## API は増やさない
 *
 * `GET /v1/restaurants/:id/dish-media`（店舗フィードが使う既存の 1 本）の 1 ページを使う。
 * 料理カテゴリー選択の «このお店の料理»（`useRestaurantDishCategories`）と同じ経路である。
 *
 * ## 失敗・0 件は «無かったこと» にする
 *
 * これは選択肢を増やす補助であって、この画面の機能ではない（撮る・選ぶ・スキップは常にできる）。
 * 引けなければ何も描かない。
 */
export type ExistingDishMedia = DishMediaEntry["dish_media"] & { dish: DishMediaEntry["dish"] };

export function ExistingDishMediaPicker({
	restaurantId,
	dishCategoryId,
	onSelect,
	testID = "review-existing-dish-media",
}: {
	restaurantId: string;
	/**
	 * #1375（6 巡目）先に決まった料理カテゴリー。渡すと **その料理の写真だけ**に絞る。
	 * 記録フローは «料理を選ぶ → 写真を選ぶ» の順になったので、ここに店の全料理を
	 * 混ぜて出すと «いま記録している料理と違う写真» を選べてしまう。
	 * null / 未指定なら従来どおり店の全メディアを出す。
	 */
	dishCategoryId?: string | null;
	onSelect: (media: ExistingDishMedia) => void;
	testID?: string;
}) {
	const styles = useThemedStyles(createStyles);
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	/** サムネイルが引けた行だけ（`thumbnailImageUrl` は非 null と分かっている） */
	type EntryWithThumbnail = DishMediaEntry & {
		dish_media: DishMediaEntry["dish_media"] & { thumbnailImageUrl: string };
	};
	const [entries, setEntries] = useState<EntryWithThumbnail[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const hasFetchedRef = useRef(false);

	useEffect(() => {
		if (hasFetchedRef.current) return;
		hasFetchedRef.current = true;
		let cancelled = false;
		void (async () => {
			try {
				const response = await callBackend<Record<string, never>, QueryRestaurantDishMediaResponse>(
					`v1/restaurants/${restaurantId}/dish-media`,
					{ method: "GET", requestPayload: {} },
				);
				if (cancelled) return;
				// サムネイルが引けない行は «顔» にならないので出さない
				setEntries(
					asApiList(response.data).filter((entry): entry is EntryWithThumbnail => !!entry.dish_media.thumbnailImageUrl),
				);
			} catch (error) {
				if (cancelled) return;
				logFrontendEvent({
					event_name: "review_existing_dish_media_failed",
					error_level: "warn",
					payload: { restaurant_id: restaurantId, error: toErrorLogString(error) },
				});
				setEntries([]);
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [callBackend, logFrontendEvent, restaurantId]);

	const handlePress = useCallback(
		(entry: EntryWithThumbnail) => {
			lightImpact();
			onSelect({ ...entry.dish_media, dish: entry.dish });
		},
		[lightImpact, onSelect],
	);

	if (isLoading) {
		return (
			<View style={styles.centered} testID={`${testID}-loading`}>
				<LoadingIndicator size="small" />
			</View>
		);
	}
	// 0 件・失敗のときは何も描かない（撮る・選ぶ・スキップは上に出ている）
	/*
	#1375（6 巡目）料理カテゴリーが決まっているなら、その料理の写真だけに絞る。
	絞った結果が 0 件なら «この料理の写真はまだ無い» ということなので、
	この節ごと出さない（下の «撮る / ライブラリ / スキップ» で足りる）。
	*/
	const visibleEntries = dishCategoryId
		? entries.filter((entry) => entry.dish.category_id === dishCategoryId)
		: entries;

	/*
	#1629【オーナー実機報告】タイルの見出しが «udon» のようなローマ字になっていた。

	`dish.name` は «その店でのその料理の呼び名» で、SNS 取り込み由来だとローマ字が入る。
	表示は `dishCategoryLabel.ts` の規則（`labels[言語] → labels["en"] → name`）で解決すること
	（`MyDishesFeedChips` / `categoryFacets` / 料理カテゴリーの候補一覧と同じ規則）。
	*/
	const labelOf = (entry: DishMediaEntry): string =>
		resolveDishCategoryLabel(entry.dish.categoryLabels, entry.dish.name, locale) ?? "";

	if (visibleEntries.length === 0) return null;

	return (
		<View style={styles.container} testID={testID}>
			<Text style={styles.heading}>{i18n.t("Map.media.pickFromExisting")}</Text>
			<FlatList
				data={visibleEntries}
				keyExtractor={(entry) => entry.dish_media.id}
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.listContent}
				renderItem={({ item }) => (
					<Pressable
						testID={`${testID}-item-${item.dish_media.id}`}
						onPress={() => handlePress(item)}
						style={styles.tile}
						accessibilityRole="button"
						accessibilityLabel={labelOf(item) || undefined}>
						<Image
							source={{
								uri: item.dish_media.thumbnailImageUrl ?? undefined,
								cacheKey: getCacheKeyForImage(item.dish_media.thumbnailImageUrl ?? undefined),
							}}
							style={styles.tileImage}
							contentFit="cover"
							cachePolicy="memory-disk"
							transition={100}
							alt=""
							accessibilityElementsHidden
							importantForAccessibility="no"
						/>
						<Text style={styles.tileLabel} numberOfLines={1} ellipsizeMode="tail">
							{labelOf(item)}
						</Text>
					</Pressable>
				)}
			/>
		</View>
	);
}

const TILE_WIDTH = 88;

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			alignSelf: "stretch",
			marginTop: 12,
		},
		centered: {
			marginTop: 12,
			alignItems: "center",
		},
		heading: {
			fontSize: 12,
			fontWeight: "700",
			color: c.textSecondary,
			marginBottom: 6,
			paddingHorizontal: 12,
		},
		listContent: {
			paddingHorizontal: 12,
			gap: 8,
		},
		tile: {
			width: TILE_WIDTH,
		},
		tileImage: {
			width: TILE_WIDTH,
			height: TILE_WIDTH,
			borderRadius: 8,
			backgroundColor: c.surfaceSubtle,
		},
		tileLabel: {
			marginTop: 4,
			fontSize: 11,
			color: c.textSecondaryStrong,
		},
	});
