/*
このファイルの責務
- my-dishes の全画面 Feed を «画面» として提供する。
- **縦 = 同じスコープ内の記録、横 = 前後のスコープ** という 2 軸にする（#1375 実機確認）。
  1 スコープぶんの中身は `features/myDishes/components/MyDishesFeedPage.tsx` が描く。

## スコープは 2 種類

| scope | URL | 横（前後） |
| --- | --- | --- |
| `restaurant` | `?scope=restaurant&restaurantId=…` | 無し（1 ページのみ） |
| `date` | `?scope=date&date=YYYY-MM-DD` | 前日 / 翌日 |

「前後」の決め方は 2 つある。

- `date` … **計算で決まる**（前日 / 翌日）。直リンクでもアプリ内遷移でも同じ結果になる
- `restaurant` … 決まらない。Map のピンの並びは viewport 依存で、URL にも
  `useMyDishesFilterStore` にも入れない（§3-2: viewport を store に入れると 964MB の
  `dish_reviews` へのクエリが pan/zoom のたびに飛ぶ。配列を URL に積むのも #1397 の
  «URL に ids を積まない» と同じ理由で採らない）。そこで **遷移直前に並びを知っている側**
  （Map）が `useMyDishesFeedScopeStore` へ置き、こちらはそれを読む。
  置かれていないとき（web の直リンク・リロード）は 1 ページへ縮退する

## 3 ページしかマウントしない

`date` でも作るページは前日・当日・翌日の 3 つだけである。さらに `MyDishesFeedPage` は
`isActive` が false の間は取得を始めない。相手は約 964MB の `dish_reviews` なので、
「隣に来るかもしれない」だけのページのぶんまで先に投げない。

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

/** `YYYY-MM-DD` を日数だけずらす。ローカル日付で計算する（Calendar のマス目と揃える） */
const shiftDate = (date: string, days: number): string | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return null;
	const [, year, month, day] = match;
	const shifted = new Date(Number(year), Number(month) - 1, Number(day) + days);
	if (Number.isNaN(shifted.getTime())) return null;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
};

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

	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { width } = useWindowDimensions();
	// ⚠️ 初回に読んだ並びで固定する。Map が裏で再検索して並びが変わっても、
	// 開いている Feed のページが増減すると横スクロールの位置が飛ぶ
	const [scopeRestaurantIds] = useState<string[]>(() => useMyDishesFeedScopeStore.getState().restaurantIds);

	/**
	 * 横に並べるスコープ。**3 ページまで**。
	 * `date` は前日・当日・翌日、`restaurant` は当該店舗のみ。
	 */
	const scopes = useMemo<MyDishesFeedScope[]>(() => {
		if (scopeKind === "date") {
			if (date === null) return [];
			const previous = shiftDate(date, -1);
			const next = shiftDate(date, 1);
			return [
				...(previous ? [{ kind: "date" as const, date: previous }] : []),
				{ kind: "date" as const, date },
				...(next ? [{ kind: "date" as const, date: next }] : []),
			];
		}
		if (restaurantId === null) return [];
		// 遷移元が並びを置いていればその前後 1 件ずつ、無ければこの店舗だけ
		const ids = scopeRestaurantIds.length > 0 ? sliceScopeWindow(scopeRestaurantIds, restaurantId) : [restaurantId];
		return ids.map((id) => ({ kind: "restaurant" as const, restaurantId: id }));
	}, [date, restaurantId, scopeKind, scopeRestaurantIds]);

	/** 開いた時点で前面に居るページ。前後が作れていれば真ん中（index 1） */
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
	// 横へ動いた先で同じ id を探しても居ないので、渡すと必ず先頭へ落ちて無駄になる
	const initialScopeIdRef = useRef<string | null>(
		scopes[initialScopeIndex] ? feedScopeId(scopes[initialScopeIndex]) : null,
	);

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
			{/* ⚠️ 閉じる導線は «横スクロールの外» に 1 つだけ置くこと。ページ側に持たせると
			    横へ動く途中で 2 つ見えるし、ここで詰まると戻る手段が無くなる
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
				horizontal
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				initialScrollIndex={initialScopeIndex}
				getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
				// 3 ページしか無いので windowSize は最小で足りる。取得を抑えているのは
				// `isActive`（下）であって、こちらはマウント数を抑えるためのもの
				windowSize={3}
				initialNumToRender={1}
				removeClippedSubviews
				onMomentumScrollEnd={(event) => {
					const next = Math.round(event.nativeEvent.contentOffset.x / width);
					setActiveScopeIndex((prev) => (prev === next ? prev : next));
				}}
				renderItem={({ item, index }) => {
					const isInitialScope = feedScopeId(item) === initialScopeIdRef.current;
					return (
						<View style={{ width }}>
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
