/*
このファイルの責務
- my-dishes（Map のピン → 料理メディア Sheet / リストビューの項目）から開く **全画面 Feed** を
  «画面» として提供する。
- URL は `restaurantId` と `itemKey` の 2 つだけで成立させ、そこから毎回引き直す。

#1397 (PR4/5) 設計 (2/2) §9-2。先例は `app/[locale]/(tabs)/notifications/feed.tsx`
（タブの Stack の中のフィードルート）と `app/[locale]/(tabs)/posts.tsx`
（`GET /v1/dish-media?ids=` → `upsertDishMediaEntries` → `updateMediaIdsByKeyAsync` →
unmount で `clearByKey`）。

## R1（最重要）**`initialIndex` ではなく `itemKey` を受ける**

Sheet / リストの並びは「写真なしの記録（`dishMedia === null`）」を含み、Feed の並びは
`dish_media.id` を持つ行だけである。したがって **両者の index は一致しない**。
index を URL に載せると、写真なしが 1 件混ざった瞬間に別の料理が開く（設計 (1/2) §3 / R1）。

そこでこのルートは `itemKey`（`MyDishItem.key` = `review:<uuid>` / `dish:<uuid>`。安定値）を受け、
`itemKey → dishMedia.id → ids.indexOf(...)` を自分で引いて index を確定させる。
「写真なしを先頭に含む並び」の回帰テストは `__tests__/myDishesFeedRoute.test.tsx`。

## URL に `ids` を積まない（設計 (2/2) §9-2）

`posts.tsx` は共有リンク用に `ids` をクエリで受けるが、記録が多い店舗では URL が数 KB になる。
`restaurantId` から引き直せるので積まない。web のリロード・直リンクでもこの形なら成立する
（共有フィルタは既定へ戻るが、**店舗スコープは URL に残る**）。

## `MyDishItem` から `DishMediaEntry` を合成しない（設計 (1/2) §2-3）

`MyDishItem` は `myReview`（自分の 1 件）しか持たず `DishMediaEntry.dish_reviews`（全ユーザー）が
無い。合成物を `useDishMediaEntriesStore` へ入れると、他画面も読む唯一のソース・オブ・トゥルースに
嘘の形が混ざる。必ず `GET /v1/dish-media?ids=` で引き直す。

## `DishMediaFeed` は 1 行も変えない（設計 (2/2) §10-1）

PR5 の contextual filter chips も、このルート側のオーバーレイとして載せる方針である。
`DishMediaFeed` を触らないことが「店舗フィード・通知フィード・投稿フィードの振る舞いが不変」
であることの証明になる。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { shallow } from "zustand/shallow";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { myDishesFeedKey } from "@/features/myDishes/constants";
import { useMyDishesRestaurantQuery } from "@/features/myDishes/hooks/useMyDishesRestaurantQuery";
import { MY_DISHES_PAGE_SIZE, useMyDishesStore } from "@/features/myDishes/stores/useMyDishesStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";

/**
 * R5: クライアント側で `ids` を切る本数。`QueryDishMediaByIdsDto` は `ArrayNotEmpty` しか持たず
 * 件数上限が無い（`@ArrayMaxSize` の追加は既存の全呼び出し元に影響するので別 Issue）。
 * 1 店舗ぶんは 1 ページ（42 件）に収まるので、ページサイズと同じ値で切る。
 */
const MAX_FEED_IDS = MY_DISHES_PAGE_SIZE;

export default function MyDishesFeedScreen() {
	const { restaurantId: restaurantIdParam, itemKey: itemKeyParam } = useLocalSearchParams<{
		restaurantId?: string | string[];
		itemKey?: string | string[];
	}>();
	const restaurantId = typeof restaurantIdParam === "string" && restaurantIdParam.length > 0 ? restaurantIdParam : null;
	const itemKey = typeof itemKeyParam === "string" && itemKeyParam.length > 0 ? itemKeyParam : null;

	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();

	// §9-2 手順 1: `restaurantId` + 共有フィルタで引き直す。Sheet と **同じ派生 queryKey** なので、
	// Sheet 経由で来たときはキャッシュに当たって 0 クエリで済む（§8-1）。
	// リスト経由 / web の直リンクではここが 1 本だけ飛ぶ（`dishes(restaurant_id)` →
	// `dish_reviews(user_id, dish_id)` の nested loop。§1-3）
	const {
		items,
		queryKey: sheetQueryKey,
		error: rowsError,
		hasFetchedInitial: hasFetchedRows,
	} = useMyDishesRestaurantQuery(restaurantId);

	const entriesKey = useMemo(() => (restaurantId ? myDishesFeedKey(restaurantId) : null), [restaurantId]);

	// §9-2 手順 2: `dishMedia !== null` の行だけを ids にする。
	// ⚠️ 文字列へ畳んでから配列に戻すことで «中身が同じなら同じ参照» にしている。
	// `items` は `itemByKey` が更新されるたびに新しい配列になるため、そのまま effect の依存へ
	// 渡すと取得が何度も走る
	const mediaIdsSignature = useMemo(
		() =>
			items
				.map((item) => (item.dishMedia ? String(item.dishMedia.id) : null))
				.filter((id): id is string => id !== null)
				.slice(0, MAX_FEED_IDS)
				.join(","),
		[items],
	);
	const mediaIds = useMemo(() => (mediaIdsSignature ? mediaIdsSignature.split(",") : []), [mediaIdsSignature]);

	/** R1: `itemKey` から «開くべき `dish_media.id`» を引く。index は URL から受け取らない */
	const targetMediaId = useMemo(() => {
		if (itemKey === null) return null;
		const target = items.find((item) => item.key === itemKey);
		return target?.dishMedia ? String(target.dishMedia.id) : null;
	}, [itemKey, items]);

	const { ids: feedIds, isLoading: isLoadingMedia, error: mediaError } = useDishMediaEntriesStore(
		selectIdsByKey(entriesKey ?? "", "dish_media"),
		shallow,
	);

	/**
	 * 「この `entriesKey` × この ids で 1 回引いた」ことの目印。
	 *
	 * ⚠️ `useDishMediaEntriesStore` の `hasFetchedInitialByKey` は **`fetchInitialByKey` 経路でしか
	 * 立たない**（`updateMediaIdsByKeyAsync` が通る `handleAsyncAction` は isLoading と error しか
	 * 触らない）。そのため成功後の再取得はこちらで止める必要がある。
	 * `requestedKeyRef` は投げた瞬間に立てて二重送信を防ぎ、**失敗したら取り消す**。
	 * 失敗後に再び叩かないことは（ref ではなく）下の `!error` ガードが受け持つ。
	 */
	const requestedKeyRef = useRef<string | null>(null);
	const [settledKey, setSettledKey] = useState<string | null>(null);
	const hydrationKey = useMemo(
		() => (entriesKey === null ? null : `${entriesKey}::${mediaIdsSignature}`),
		[entriesKey, mediaIdsSignature],
	);

	/**
	 * Q4（リーダー判断 (b)）: Feed セッション中に save の追加・解除が **起きたときだけ**、
	 * 閉じるときに店舗スコープの Sheet スライスだけを invalidate する。
	 *
	 * dirty フラグは «取得直後のサーバ値» と «閉じる直前のストア値» の差で判定する。
	 * `ActionButtons` は save を `useDishMediaEntriesStore.updateEntry` で楽観更新するので、
	 * `DishMediaFeed` にも `ActionButtons` にも手を入れずにここだけで観測できる。
	 * 押して戻した（＝正味の変化なし）ときは差が出ないので invalidate しない。
	 */
	const initialSavedRef = useRef<Record<string, boolean>>({});
	// 閉じるときに読む値。クリーンアップを `entriesKey` だけの依存に保つためミラーする
	const sheetQueryKeyRef = useRef<string | null>(null);
	sheetQueryKeyRef.current = sheetQueryKey;

	// §9-2 手順 3: `GET /v1/dish-media?ids=...` → `upsertDishMediaEntries` + `updateMediaIdsByKeyAsync`
	// （`posts.tsx` の作法）。
	// ⚠️ `!error` を必ず条件へ入れること。失敗すると `hasFetchedInitialByKey` は false のまま
	// `isLoadingByKey` が false へ戻るので（stores/useDishMediaEntriesStore.ts の handleAsyncAction）、
	// error を見ないと **失敗するたびに再取得して無限ループする**
	useEffect(() => {
		if (entriesKey === null || hydrationKey === null || mediaIds.length === 0) return;
		if (requestedKeyRef.current === hydrationKey) return;
		if (isLoadingMedia || mediaError) return;
		requestedKeyRef.current = hydrationKey;

		let cancelled = false;
		const { upsertDishMediaEntries, updateMediaIdsByKeyAsync } = useDishMediaEntriesStore.getState();
		const idsPromise = callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
			method: "GET",
			requestPayload: { ids: mediaIds },
		}).then((res) => {
			upsertDishMediaEntries(res.items);
			// Q4: 取得直後のサーバ値を dirty 判定の基準に取る
			const snapshot: Record<string, boolean> = {};
			for (const item of res.items) snapshot[String(item.dish_media.id)] = Boolean(item.dish_media.isSaved);
			initialSavedRef.current = snapshot;
			return res.items.map((item) => String(item.dish_media.id));
		});

		idsPromise.then(
			() => {
				if (!cancelled) setSettledKey(hydrationKey);
			},
			() => {
				// 失敗は «未取得» に戻す。次に叩くかどうかは `!error` ガードだけが決める
				requestedKeyRef.current = null;
			},
		);

		// ⚠️ 並び順は **Sheet / リストで見えている順**（= `mediaIds`）に揃える。API の戻り順に
		// 任せると、`itemKey` から引いた index が指す料理と実際の並びがずれる
		void updateMediaIdsByKeyAsync(entriesKey, idsPromise, (_prev, fetchedIds) => {
			const fetched = new Set(fetchedIds);
			return mediaIds.filter((id) => fetched.has(id));
		});

		return () => {
			cancelled = true;
		};
	}, [callBackend, entriesKey, hydrationKey, isLoadingMedia, mediaError, mediaIds]);

	// §9-2 手順 5: unmount で `clearByKey`。その前に Q4 の dirty 判定を済ませる
	useEffect(() => {
		if (entriesKey === null) return;
		return () => {
			const state = useDishMediaEntriesStore.getState();
			const dirty = Object.entries(initialSavedRef.current).some(([id, wasSaved]) => {
				const entry = state.entriesByMediaId[id];
				return entry !== undefined && Boolean(entry.dish_media.isSaved) !== wasSaved;
			});
			// ⚠️ base（一覧・Map 共有）の queryKey は **絶対に invalidate しない**。
			// あれは 964MB の `dish_reviews` に対する走査になる（#1395 §0(A)）。
			// 消すのは店舗スコープの Sheet スライス 1 本だけで、これは nested loop に落ちて安い
			if (dirty && sheetQueryKeyRef.current !== null) {
				useMyDishesStore.getState().clearQuery(sheetQueryKeyRef.current);
			}
			state.clearByKey(entriesKey);
			initialSavedRef.current = {};
		};
	}, [entriesKey]);

	/** R1: index は «Feed が実際に並べている ids» に対して引く。見つからなければ先頭 */
	const initialIndex = useMemo(() => {
		if (targetMediaId === null) return 0;
		const index = feedIds.indexOf(targetMediaId);
		return index >= 0 ? index : 0;
	}, [feedIds, targetMediaId]);

	const handleClose = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "my_dishes_feed_closed",
			error_level: "log",
			payload: { restaurantId, itemKey, canDismiss: router.canDismiss() },
		});

		if (router.canDismiss()) {
			router.back();
			return;
		}
		// 履歴が無い着地（URL 直リンク / リロード）の保険。出発点は my-dishes タブ
		router.replace({ pathname: "/[locale]/(tabs)/my-dishes", params: { locale } });
	}, [itemKey, lightImpact, locale, logFrontendEvent, restaurantId]);

	// ⚠️ ローディングは «まだ結果が出ていない» ときだけに絞ること。失敗しても止まる形にしないと
	// スピナーで固着する（`restaurant/[restaurantId]/feed.tsx` と同じ判断）
	const isFetchingRows = restaurantId !== null && !hasFetchedRows && rowsError === null;
	const isHydratingMedia = mediaIds.length > 0 && settledKey !== hydrationKey && mediaError === null;
	const showLoading = feedIds.length === 0 && (isFetchingRows || isHydratingMedia);
	// 「行は読めたが写真ありが 1 件も無い」「取得に失敗した」のどちらも «見るものが無い» なので同じ表示
	const showEmpty = !showLoading && feedIds.length === 0;

	return (
		<View style={styles.container} testID="my-dishes-feed-screen">
			{/* ⚠️ 閉じる導線は «下の分岐の外» に置くこと。ここで詰まると戻る手段が無くなる
			    （`restaurant/[restaurantId]/feed.tsx` と同じ判断） */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity
					testID="my-dishes-feed-close-button"
					style={styles.closeButton}
					onPress={handleClose}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.close")}>
					<X size={24} color="#FFF" />
				</TouchableOpacity>
			</View>

			{entriesKey !== null && feedIds.length > 0 ? (
				// ⚠️ `initialIndex` は «ids が確定してから» 渡す。DishMediaFeed は最初に届いた
				// 非空の ids で並びを固定するので、ここで描き始める時点の index が最終値になる
				<DishMediaFeed entriesKey={entriesKey} idType="dish_media" initialIndex={initialIndex} />
			) : showLoading ? (
				<View style={styles.centered} testID="my-dishes-feed-loading">
					<LoadingIndicator size="large" />
				</View>
			) : showEmpty ? (
				<View style={styles.centered} testID="my-dishes-feed-empty">
					<Text style={styles.emptyText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	centered: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
	},
	emptyText: {
		fontSize: 16,
		color: "#FFF",
		textAlign: "center",
	},
	// search/result.tsx / restaurant/[restaurantId]/feed.tsx と同じ形（フィードの上に浮かせる）
	closeButtonContainer: {
		position: "absolute",
		right: 16,
		zIndex: 10,
	},
	closeButton: {
		padding: 12,
	},
});
