/*
このファイルの責務
- my-dishes の全画面 Feed を «画面» として提供する。スコープごとの中身は
  `features/myDishes/components/MyDishesFeedPage.tsx` が描く。

## 軸の向きは 2 スコープで揃える（#1375 実機確認 5 巡目）

| scope | 外側（このファイルのページャ） | 内側（MyDishesFeedPage） |
| --- | --- | --- |
| `restaurant` | **縦** = 前後の店舗 | 横 = その店舗の記録（n/m のバーを出す） |
| `date` | **縦** = 前後の «記録がある日» | 横 = その日の記録（n/m のバーを出す） |

2 巡目で date だけを «縦=日 / 横=同じ日の投稿» にしたところ、5 巡目の実機確認で
「Map から開いた方も同じにしてほしい（縦でレストランを切り替え、横で同じ店の中）」と
指摘された。**同じ全画面フィードなのに入口によって指の向きが変わる**のが理由である。
どちらも Instagram のストーリーズと同じ軸に揃えた。

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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";

import { FixedColors } from "@/constants/Palette";
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
	// #1375 実機確認（5 巡目）: 外側は **常に縦**。scope が restaurant なら前後の店舗、
	// date なら前後の «記録がある日» を縦フリックで行き来する（入口で指の向きを変えない）
	const isVerticalPager = true;

	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	/**
	 * ⚠️ ページ寸法は **実レイアウト**（onLayout）から取る。`useWindowDimensions()` は
	 * タブバー・SafeArea を含むウィンドウ全体の寸法で、このルートは (tabs) の中に居るため
	 * リストの実高はそれより小さい。ウィンドウ高で `initialScrollIndex` のオフセットを
	 * 計算すると **ページとページの隙間（真っ黒）に着地する**（iPhone 実機で発生した黒画面）。
	 */
	const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
	const pagerRef = useRef<FlatList<MyDishesFeedScope>>(null);
	// ⚠️ 初回に読んだ並びで固定する。遷移元が裏で再検索して並びが変わっても、
	// 開いている Feed のページが増減するとスクロール位置が飛ぶ
	const [scopeRestaurantIds] = useState<string[]>(() => useMyDishesFeedScopeStore.getState().restaurantIds);
	// #1629 並びの出どころ。list（一覧）由来なら前後を絞らない（下のコメント参照）
	const [scopeSource] = useState(() => useMyDishesFeedScopeStore.getState().restaurantIdsSource);
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
		/*
		#1629 【修正】オーナー実機報告「グリッドのフィードが無限に下スクロールできない」。

		縦ページャの中身は遷移元が置いた並びだが、**Map 由来と一覧由来を同じに扱っていた**。
		`sliceScopeWindow` は前後 1 件しか残さないので、一覧から入ると縦は **3 ページで終わる**。
		Map は viewport 由来でピンが 200 件あることもあり «前後 1 件» に意味があるが、
		一覧は «上から順に見ていく» 面なので、縦にフリックし続けたら一覧の最後まで行けるのが
		期待される挙動である。

		出どころで分ける。一覧由来は絞らない。
		⚠️ ページ数が増えてもマウントされるのは `windowSize={3}` のぶんだけで、
		   取得は `isActive` が止めている（ページを増やしても取得は増えない）。
		*/
		const ids =
			scopeRestaurantIds.length === 0
				? [restaurantId]
				: scopeSource === "list"
					? scopeRestaurantIds
					: sliceScopeWindow(scopeRestaurantIds, restaurantId);
		return ids.map((id) => ({ kind: "restaurant" as const, restaurantId: id }));
	}, [date, restaurantId, scopeDateKeys, scopeKind, scopeRestaurantIds, scopeSource]);

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

	// 縦ページャはページ長 = リスト実高、横ページャはページ長 = リスト実幅
	const pageLength = pageSize === null ? 0 : isVerticalPager ? pageSize.height : pageSize.width;

	// ⚠️ 測り直しで pageLength が変わっても contentOffset(px) は据え置かれ、ページ境界から
	// ずれた位置に取り残される（web のウィンドウリサイズで再現。独立レビュー指摘）。
	// いま前面のページ境界へ合わせ直す
	const activeScopeIndexRef = useRef(initialScopeIndex);
	useEffect(() => {
		if (pageLength <= 0) return;
		pagerRef.current?.scrollToIndex({ index: activeScopeIndexRef.current, animated: false });
	}, [pageLength]);

	// ページャの props は identity を固定する（インラインだと activeScopeIndex が動くたびに
	// マウント中の全ページへ新しい props が流れる。独立レビュー指摘）
	const handleMomentumScrollEnd = useCallback(
		(event: { nativeEvent: { contentOffset: { x: number; y: number } } }) => {
			if (pageLength <= 0) return;
			const offset = isVerticalPager ? event.nativeEvent.contentOffset.y : event.nativeEvent.contentOffset.x;
			const next = Math.round(offset / pageLength);
			activeScopeIndexRef.current = next;
			setActiveScopeIndex((prev) => (prev === next ? prev : next));
		},
		[isVerticalPager, pageLength],
	);
	const getItemLayout = useCallback(
		(_data: unknown, index: number) => ({ length: pageLength, offset: pageLength * index, index }),
		[pageLength],
	);
	const handleScrollToIndexFailed = useCallback(({ index }: { index: number }) => {
		setTimeout(() => {
			pagerRef.current?.scrollToIndex({ index, animated: false });
		}, 250);
	}, []);

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
					{/* 固定黒のメディアビューアの上に載る閉じるボタン。テーマで振らない */}
					<X size={24} color={FixedColors.onMedia} />
				</TouchableOpacity>
			</View>

			<View
				style={styles.pagerContainer}
				onLayout={(event) => {
					const { width, height } = event.nativeEvent.layout;
					const next = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
					setPageSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
				}}>
				{/* 寸法が確定するまで描かない（初期スクロール不発と黒画面の防止） */}
				{pageSize !== null && pageLength > 0 && (
					<FlatList
						ref={pagerRef}
						testID="my-dishes-feed-pager"
						data={scopes}
						keyExtractor={feedScopeId}
						horizontal={!isVerticalPager}
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						showsVerticalScrollIndicator={false}
						initialScrollIndex={initialScopeIndex}
						getItemLayout={getItemLayout}
						// マウント数を抑える（取得を抑えるのは `isActive`。date は全日をページに持つので特に効く）
						windowSize={3}
						initialNumToRender={1}
						onMomentumScrollEnd={handleMomentumScrollEnd}
						// 初期スクロールがレイアウト確定前に走って失敗したときの保険（DishMediaFeed と同じ作法）
						onScrollToIndexFailed={handleScrollToIndexFailed}
						renderItem={({ item, index }) => {
							const isInitialScope = feedScopeId(item) === initialScopeIdRef.current;
							return (
								<View style={isVerticalPager ? { height: pageSize.height } : { width: pageSize.width }}>
									<MyDishesFeedPage
										scope={item}
										itemKey={isInitialScope ? itemKey : null}
										dishMediaId={isInitialScope ? dishMediaId : null}
										isActive={index === activeScopeIndex}
										/* #1629 進行方向（下）の 1 ページだけ先読みさせる。
										   オーナー実機報告「5 秒待って下っていくとローディングが 1〜2 秒」の対処。
										   詳細と «なぜ 1 ページだけか» は MyDishesFeedPage の shouldPrefetch の JSDoc */
										shouldPrefetch={index === activeScopeIndex + 1}
									/>
								</View>
							);
						}}
					/>
				)}
			</View>
		</View>
	);
}

// テーマ非依存（メディアビューアの固定黒）なので、ファクトリ化せずモジュールスコープのままでよい
const styles = StyleSheet.create({
	container: {
		flex: 1,
		// 「メディアを引き立てる黒背景」（DishMediaFeed.tsx と同じ仕様）。ライトでも黒のまま
		backgroundColor: FixedColors.mediaBackground,
	},
	pagerContainer: {
		flex: 1,
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
