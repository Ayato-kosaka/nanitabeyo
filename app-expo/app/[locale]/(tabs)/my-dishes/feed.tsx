/*
このファイルの責務
- my-dishes の全画面 Feed を «画面» として提供する。スコープごとの中身は
  `features/myDishes/components/MyDishesFeedPage.tsx` が描く。

## 軸の向きはスコープで変わる（#1375 実機確認 2 巡目）

| scope | 外側（このファイルのページャ） | 内側（MyDishesFeedPage） |
| --- | --- | --- |
| `restaurant` | **横** = 前後の店舗 | 縦 = その店舗の記録 |
| `date` | **縦** = 前後の «記録がある日» | 横 = その日の記録（n/m のバーを出す） |

date が縦になったのは実機確認の指摘による。「上フリックで次の日付へ、下フリックで前の
日付へ遡り、横で同じ日の別の投稿を見る」— Instagram のストーリーズと同じ軸である。

## «前後» の決め方

- `date` … **記録がある日だけ**を並べる。±1 日の計算だと隣が空で「見つかりません」の
  ページが挟まる（実機で指摘された）。並びは Calendar が遷移直前に
  `useMyDishesFeedScopeStore.dateKeys`（昇順）へ置く。置かれていないとき
  （web の直リンク・リロード）は 1 日だけへ縮退する
- `restaurant` … Map のピンの並びは viewport 依存で、URL にも `useMyDishesFilterStore` にも
  入れない（§3-2: viewport を store に入れると 964MB の `dish_reviews` へのクエリが
  pan/zoom のたびに飛ぶ。配列を URL に積むのも #1397 の «URL に ids を積まない» と同じ理由）。
  Map が `useMyDishesFeedScopeStore` へ置き、こちらはそれを読む。無ければ 1 ページへ縮退

## 取得は «前面のページだけ»

`MyDishesFeedPage` は `isActive` が false の間は取得を始めない。相手は約 964MB の
`dish_reviews` なので、「隣に来るかもしれない」だけのページのぶんまで先に投げない。
date の全日をページとして持っても、マウントは `windowSize` が、取得は `isActive` が絞る。

## 旧 URL（`?restaurantId=` だけ）も受ける

`scope` が無いときは `restaurantId` の有無で判断する。Map の Sheet / リストからの既存の
push が壊れないようにするため。
*/
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";

import { MY_DISHES_EVENTS } from "@/features/myDishes/analytics";
import { MyDishesFeedPage, feedScopeId, type MyDishesFeedScope } from "@/features/myDishes/components/MyDishesFeedPage";
import { sliceScopeWindow, useMyDishesFeedScopeStore } from "@/features/myDishes/stores/useMyDishesFeedScopeStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

const firstParam = (value: string | string[] | undefined): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

export default function MyDishesFeedScreen() {
	const {
		scope: scopeParam,
		restaurantId: restaurantIdParam,
		date: dateParam,
		itemKey: itemKeyParam,
		dishMediaId: dishMediaIdParam,
	} = useLocalSearchParams<{
		scope?: string | string[];
		restaurantId?: string | string[];
		date?: string | string[];
		itemKey?: string | string[];
		dishMediaId?: string | string[];
	}>();

	const restaurantId = firstParam(restaurantIdParam);
	const date = firstParam(dateParam);
	const itemKey = firstParam(itemKeyParam);
	const dishMediaId = firstParam(dishMediaIdParam);
	// `scope` が無い旧 URL は `restaurantId` の有無で判断する
	const scopeKind =
		firstParam(scopeParam) === "date" || (firstParam(scopeParam) === null && date !== null) ? "date" : "restaurant";
	// date = 縦ページャ / restaurant = 横ページャ（ファイル冒頭の表）
	const isVerticalPager = scopeKind === "date";

	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { width, height } = useWindowDimensions();
	// ⚠️ 初回に読んだ並びで固定する。遷移元が裏で再検索して並びが変わっても、
	// 開いている Feed のページが増減するとスクロール位置が飛ぶ
	const [scopeRestaurantIds] = useState<string[]>(() => useMyDishesFeedScopeStore.getState().restaurantIds);
	const [scopeDateKeys] = useState<string[]>(() => useMyDishesFeedScopeStore.getState().dateKeys);

	/** ページャに並べるスコープ */
	const scopes = useMemo<MyDishesFeedScope[]>(() => {
		if (scopeKind === "date") {
			if (date === null) return [];
			// 記録がある日だけ。Calendar が並びを置いていなければ（直リンク）1 日へ縮退する
			const keys = scopeDateKeys.includes(date) ? scopeDateKeys : [date];
			return keys.map((key) => ({ kind: "date" as const, date: key }));
		}
		if (restaurantId === null) return [];
		// 遷移元が並びを置いていればその前後 1 件ずつ、無ければこの店舗だけ
		const ids = scopeRestaurantIds.length > 0 ? sliceScopeWindow(scopeRestaurantIds, restaurantId) : [restaurantId];
		return ids.map((id) => ({ kind: "restaurant" as const, restaurantId: id }));
	}, [date, restaurantId, scopeDateKeys, scopeKind, scopeRestaurantIds]);

	/** 開いた時点で前面に居るページ */
	const initialScopeIndex = useMemo(() => {
		if (scopes.length === 0) return 0;
		const currentId =
			scopeKind === "date" && date !== null
				? feedScopeId({ kind: "date", date })
				: restaurantId !== null
					? feedScopeId({ kind: "restaurant", restaurantId })
					: null;
		if (currentId === null) return 0;
		const index = scopes.findIndex((scope) => feedScopeId(scope) === currentId);
		return index >= 0 ? index : 0;
	}, [date, restaurantId, scopeKind, scopes]);

	const [activeScopeIndex, setActiveScopeIndex] = useState(initialScopeIndex);
	// 「開いた位置の手がかり（itemKey / dishMediaId）」は最初に開いたページにだけ渡す。
	// 別のページで同じ id を探しても居ないので、渡すと必ず先頭へ落ちて無駄になる
	const initialScopeIdRef = useRef<string | null>(
		scopes[initialScopeIndex] ? feedScopeId(scopes[initialScopeIndex]) : null,
	);

	// 縦ページャはページ長 = 画面高、横ページャはページ長 = 画面幅
	const pageLength = isVerticalPager ? height : width;

	const handleClose = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: MY_DISHES_EVENTS.feedClosed,
			error_level: "log",
			payload: { restaurantId, date, itemKey, canDismiss: router.canDismiss() },
		});

		if (router.canDismiss()) {
			router.back();
			return;
		}
		// 履歴が無い着地（URL 直リンク / リロード）の保険。出発点は my-dishes タブ
		router.replace({ pathname: "/[locale]/(tabs)/my-dishes", params: { locale } });
	}, [date, itemKey, lightImpact, locale, logFrontendEvent, restaurantId]);

	return (
		<View style={styles.container} testID="my-dishes-feed-screen">
			{/* ⚠️ 閉じる導線は «ページャの外» に 1 つだけ置くこと。ページ側に持たせると
			    ページ間を動く途中で 2 つ見えるし、ここで詰まると戻る手段が無くなる
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

			<FlatList
				testID="my-dishes-feed-pager"
				data={scopes}
				keyExtractor={feedScopeId}
				horizontal={!isVerticalPager}
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				showsVerticalScrollIndicator={false}
				initialScrollIndex={initialScopeIndex}
				getItemLayout={(_data, index) => ({ length: pageLength, offset: pageLength * index, index })}
				// マウント数を抑える（取得を抑えるのは `isActive`。date は全日をページに持つので特に効く）
				windowSize={3}
				initialNumToRender={1}
				removeClippedSubviews
				onMomentumScrollEnd={(event) => {
					const offset = isVerticalPager ? event.nativeEvent.contentOffset.y : event.nativeEvent.contentOffset.x;
					const next = Math.round(offset / pageLength);
					setActiveScopeIndex((prev) => (prev === next ? prev : next));
				}}
				renderItem={({ item, index }) => {
					const isInitialScope = feedScopeId(item) === initialScopeIdRef.current;
					return (
						<View style={isVerticalPager ? { height } : { width }}>
							<MyDishesFeedPage
								scope={item}
								itemKey={isInitialScope ? itemKey : null}
								dishMediaId={isInitialScope ? dishMediaId : null}
								isActive={index === activeScopeIndex}
							/>
						</View>
					);
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
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
