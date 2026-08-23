/*
このファイルの責務
- my-dishes の全画面 Feed の **1 スコープぶん**を描く。スコープは «1 店舗» か «1 日» のどちらか。
- 中身は `app/[locale]/(tabs)/my-dishes/feed.tsx` にあったものをそのまま移したものである。
  ルートを横スクロール（前後のスコープ）にするため、1 ページを部品として切り出した。

#1397 (PR4/5) 設計 (2/2) §9-2 の判断はすべてそのまま生きている。以下は移設前の説明。

## R1（最重要）**`initialIndex` ではなく `itemKey` を受ける**

Sheet / リストの並びは「写真なしの記録（`dishMedia === null`）」を含み、Feed の並びは
`dish_media.id` を持つ行だけである。したがって **両者の index は一致しない**。
index を URL に載せると、写真なしが 1 件混ざった瞬間に別の料理が開く（設計 (1/2) §3 / R1）。

## `MyDishItem` から `DishMediaEntry` を合成しない（設計 (1/2) §2-3）

`MyDishItem` は `myReview`（自分の 1 件）しか持たず `DishMediaEntry.dish_reviews`（全ユーザー）が
無い。合成物を `useDishMediaEntriesStore` へ入れると、他画面も読む唯一のソース・オブ・トゥルースに
嘘の形が混ざる。必ず `GET /v1/dish-media?ids=` で引き直す。

## `DishMediaFeed` は 1 行も変えない（設計 (2/2) §10-1）

PR5 の contextual filter chips も、このページ側のオーバーレイとして載せている。現在表示中の
エントリは `DishMediaFeed` の既存 prop `onIndexChange` で拾うだけなので、`DishMediaFeed` は
1 行も変わらない。これが「店舗フィード・通知フィード・投稿フィードの振る舞いが不変」であることの
証明になる。

## #1375 実機確認: 閉じるボタンはここに置かない

閉じるボタンはルート側（横スクロールの外）に 1 つだけ置く。ページごとに持つと、
横スクロールの途中で 2 つ見えてしまう。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { shallow } from "zustand/shallow";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { MyDishesFeedChips } from "@/features/myDishes/components/MyDishesFeedChips";
import { myDishesFeedKey } from "@/features/myDishes/constants";
import { useMyDishesDateQuery } from "@/features/myDishes/hooks/useMyDishesDateQuery";
import { useMyDishesRestaurantQuery } from "@/features/myDishes/hooks/useMyDishesRestaurantQuery";
import { MY_DISHES_PAGE_SIZE, useMyDishesStore } from "@/features/myDishes/stores/useMyDishesStore";
import { useAPICall } from "@/hooks/useAPICall";
import i18n from "@/lib/i18n";
import { selectEntryByMediaId, selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";

/**
 * R5: クライアント側で `ids` を切る本数。`QueryDishMediaByIdsDto` は `ArrayNotEmpty` しか持たず
 * 件数上限が無い（`@ArrayMaxSize` の追加は既存の全呼び出し元に影響するので別 Issue）。
 * 1 店舗ぶんは 1 ページ（42 件）に収まるので、ページサイズと同じ値で切る。
 */
const MAX_FEED_IDS = MY_DISHES_PAGE_SIZE;

/** このページが «何で切られているか»。店舗か日付のどちらか 1 つ */
export type MyDishesFeedScope = { kind: "restaurant"; restaurantId: string } | { kind: "date"; date: string };

/** スコープを `entriesKey` / 横スクロールの key に使える 1 本の文字列へ畳む */
export const feedScopeId = (scope: MyDishesFeedScope): string =>
	scope.kind === "restaurant" ? scope.restaurantId : `date:${scope.date}`;

export type MyDishesFeedPageProps = {
	scope: MyDishesFeedScope;
	/** 開いた位置の手がかり。横スクロールで «隣» のページには渡さない */
	itemKey?: string | null;
	dishMediaId?: string | null;
	/**
	 * いま前面に居るページか。
	 *
	 * ⚠️ `false` の間は **取得を始めない**。横スクロールの ±1 は「すぐ隣へ来るかもしれない」
	 * だけで、必ず見るとは限らない。相手は約 964MB の `dish_reviews` なので、
	 * 見えていないページのぶんまで先に投げない（設計 (2/2) §1-3 と同じ理由）。
	 */
	isActive: boolean;
};

// ⚠️ memo でくるむ（独立レビュー指摘）。外側ページャの `activeScopeIndex` が動くたびに
// マウント中の全ページが再レンダーされ、各ページの派生クエリ 2 本が再実行されていた
export const MyDishesFeedPage = React.memo(function MyDishesFeedPage({
	scope,
	itemKey = null,
	dishMediaId = null,
	isActive,
}: MyDishesFeedPageProps) {
	const styles = useThemedStyles(createStyles);
	const restaurantId = scope.kind === "restaurant" ? scope.restaurantId : null;
	const date = scope.kind === "date" ? scope.date : null;
	const dishMediaIdParam = dishMediaId;
	// M-2: 1 店舗 43 件以上だと itemKey が指す行が取得済みの 1 ページ（42 件）に無いことがある。
	// 呼び出し元は必ず item.dishMedia.id を持っているので、そちらを同一性の根拠にする
	// （itemKey は残すが、位置は index ではなくこの id で決める）
	const dishMediaIdFromParams =
		typeof dishMediaIdParam === "string" && dishMediaIdParam.length > 0 ? dishMediaIdParam : null;

	const { callBackend } = useAPICall();

	// §9-2 手順 1: `restaurantId` + 共有フィルタで引き直す。Sheet と **同じ派生 queryKey** なので、
	// Sheet 経由で来たときはキャッシュに当たって 0 クエリで済む（§8-1）。
	// リスト経由 / web の直リンクではここが 1 本だけ飛ぶ（`dishes(restaurant_id)` →
	// `dish_reviews(user_id, dish_id)` の nested loop。§1-3）
	// #1375 実機確認: スコープに応じて派生クエリを選ぶ。**どちらも同じ `useMyDishesStore.byQuery`**
	// を別スライスとして引くので、store は増えていない（§8-1 の作法をそのまま踏襲）。
	// ⚠️ `isActive` が false の間は `null` を渡して取得させない（見えていないページを先に取らない）
	const restaurantQuery = useMyDishesRestaurantQuery(isActive ? restaurantId : null);
	const dateQuery = useMyDishesDateQuery(isActive ? date : null);
	const {
		items,
		queryKey: sheetQueryKey,
		error: rowsError,
		hasFetchedInitial: hasFetchedRows,
		refresh: refreshRows,
	} = scope.kind === "restaurant" ? restaurantQuery : dateQuery;

	const entriesKey = useMemo(() => (isActive ? myDishesFeedKey(feedScopeId(scope)) : null), [isActive, scope]);

	// §9-2 手順 2: `dishMedia !== null` の行だけを ids にする。
	// ⚠️ 文字列へ畳んでから配列に戻すことで «中身が同じなら同じ参照» にしている。
	// `items` は `itemByKey` が更新されるたびに新しい配列になるため、そのまま effect の依存へ
	// 渡すと取得が何度も走る
	//
	// M-2: `dishMediaIdFromParams` がこのページの中に無ければ（1 店舗 43 件以上でページ外の記録を
	// タップした場面）先頭へ積む。位置（index）ではなく id そのものを ids に含めることで、
	// タップした料理を必ず取得できるようにする
	// ⚠️ `hasFetchedRows` を待つこと。待たずに `dishMediaIdFromParams` だけで signature を作ると、
	// 行がまだ 0 件のうちに «その 1 件だけ» で GET /v1/dish-media が飛び、行が届いたあとの
	// 本来の signature でもう一度飛ぶ（2 回叩く）
	const mediaIdsSignature = useMemo(() => {
		if (!hasFetchedRows) return "";
		const pageIds = items
			.map((item) => (item.dishMedia ? String(item.dishMedia.id) : null))
			.filter((id): id is string => id !== null)
			.slice(0, MAX_FEED_IDS);
		const ids =
			dishMediaIdFromParams !== null && !pageIds.includes(dishMediaIdFromParams)
				? [dishMediaIdFromParams, ...pageIds]
				: pageIds;
		return ids.join(",");
	}, [items, dishMediaIdFromParams, hasFetchedRows]);
	const mediaIds = useMemo(() => (mediaIdsSignature ? mediaIdsSignature.split(",") : []), [mediaIdsSignature]);

	/**
	 * R1 / M-2: «開くべき `dish_media.id`» を決める。index は URL から受け取らない。
	 * `dishMediaId` が渡っていればそれを直接使う（呼び出し元は必ず持っている）。無い呼び出し元
	 * （旧リンク等）だけ `itemKey` から取得済みページ内を探すフォールバックへ回す
	 */
	const targetMediaId = useMemo(() => {
		if (dishMediaIdFromParams !== null) return dishMediaIdFromParams;
		if (itemKey === null) return null;
		const target = items.find((item) => item.key === itemKey);
		return target?.dishMedia ? String(target.dishMedia.id) : null;
	}, [dishMediaIdFromParams, itemKey, items]);

	const {
		ids: feedIds,
		isLoading: isLoadingMedia,
		error: mediaError,
	} = useDishMediaEntriesStore(selectIdsByKey(entriesKey ?? "", "dish_media"), shallow);

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
	// m-3: 食べた記録の反映（ActionButtons → review-from-media）はここでは拾わない。
	// `items` はこの画面が取得した時点のスナップショットなので stale で、安く検知できない。
	// 正しい機構は #1398 PR4 が入れる `revision` bump 側で拾うこと（この PR のスコープ外）

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

		callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
			method: "GET",
			requestPayload: { ids: mediaIds },
		}).then(
			(res) => {
				// M-1: 決着前に unmount されていたら、ストアには一切書かない。下の unmount 側の
				// `clearByKey` より «後» に決着すると、ここで書いたものが誰にも消されず残ってしまい、
				// 次に同じ店を開いたとき古い並びのまま固定される
				if (cancelled) return;
				upsertDishMediaEntries(res.items);
				// Q4: 取得直後のサーバ値を dirty 判定の基準に取る
				const snapshot: Record<string, boolean> = {};
				for (const item of res.items) snapshot[String(item.dish_media.id)] = Boolean(item.dish_media.isSaved);
				initialSavedRef.current = snapshot;

				const fetchedIds = res.items.map((item) => String(item.dish_media.id));
				// ⚠️ 並び順は **Sheet / リストで見えている順**（= `mediaIds`）に揃える。API の戻り順に
				// 任せると、`itemKey` / `dishMediaId` から引いた index が指す料理と実際の並びがずれる
				void updateMediaIdsByKeyAsync(entriesKey, Promise.resolve(fetchedIds), (_prev, ids) => {
					const fetched = new Set(ids);
					return mediaIds.filter((id) => fetched.has(id));
				}).then(() => {
					if (!cancelled) setSettledKey(hydrationKey);
				});
			},
			() => {
				if (cancelled) return;
				// 失敗は «未取得» に戻す。次に叩くかどうかは `!error` ガードだけが決める
				requestedKeyRef.current = null;
				// m-1: ストアの error 状態へも反映する（`mediaError` を非 null にして、再取得ループと
				// スピナー固着の両方を防ぐ）。専用の setError が無いので、失敗した promise を渡して
				// 既存のエラー経路（`handleAsyncAction` の catch）に載せる
				void updateMediaIdsByKeyAsync(
					entriesKey,
					Promise.reject(new Error("dish-media fetch failed")),
					(prevIds) => prevIds,
				).catch(() => {});
			},
		);

		return () => {
			cancelled = true;
		};
	}, [callBackend, entriesKey, hydrationKey, isLoadingMedia, mediaError, mediaIds]);

	// §9-2 手順 5: **本当の unmount** で `clearByKey`。その前に Q4 の dirty 判定を済ませる。
	//
	// ⚠️ 独立レビュー指摘（High）: 以前は依存を `[entriesKey]` にしていたが、`entriesKey` は
	// `isActive` が false になると null へ変わるため、**隣のページへフリックしただけ**で
	// クリーンアップが走って entry が消えていた。ところがページ自体は windowSize=3 で
	// 生き残るので `requestedKeyRef` は前の値のまま残り、戻ってきたとき
	// 「hydrationKey が同一 → 再取得スキップ → feedIds は消えたまま → 見つかりません」
	// になる（実機の縦フリック往復で再現）。エントリの破棄は unmount だけにすれば、
	// 往復のたびの `GET /v1/dish-media?ids=` 再送も同時に無くなる。
	// 「取得を始めない」ことは hooks へ null を渡す側（`isActive` 分岐）が既に担っている
	const lastEntriesKeyRef = useRef<string | null>(null);
	useEffect(() => {
		if (entriesKey !== null) lastEntriesKeyRef.current = entriesKey;
	}, [entriesKey]);
	useEffect(() => {
		return () => {
			const key = lastEntriesKeyRef.current;
			if (key === null) return;
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
			state.clearByKey(key);
			initialSavedRef.current = {};
		};
	}, []);

	/** R1: index は «Feed が実際に並べている ids» に対して引く。見つからなければ先頭 */
	const initialIndex = useMemo(() => {
		if (targetMediaId === null) return 0;
		const index = feedIds.indexOf(targetMediaId);
		return index >= 0 ? index : 0;
	}, [feedIds, targetMediaId]);

	/**
	 * #1397 (PR5/5) chips が読む「いま見ているエントリ」。
	 *
	 * `DishMediaFeed` の既存 prop `onIndexChange` で index だけを受け取り、`feedIds` を引いて
	 * `dish_media.id` へ変換する（先例: `features/map/components/FeedDishMediaViewer.tsx` の
	 * 「現在の index からエントリを snapshot 読みする」形）。**`DishMediaFeed` は 1 行も変えない**。
	 *
	 * ⚠️ 初期値を `0` にしないこと。`onIndexChange` は viewability が **変化したとき**にしか
	 * 発火しないので（`DishMediaFeed.tsx` の `v.index === prev` ガード）、`initialIndex` の位置で
	 * 開いてそのまま何もスワイプしなかった場合は 1 度も呼ばれない。`null` を初期値にして
	 * 「まだ通知が来ていない間は `initialIndex` を見る」形にすると、開いた瞬間から
	 * **実際に見ている料理**の chip が出る。
	 *
	 * ⚠️ `DishMediaFeed` は最初に届いた非空の ids を内部 state に固定する。ここで引いている
	 * `feedIds` はストアの生値だが、ハイドレーション後にこのキーの ids を書き換える経路は
	 * unmount 時の `clearByKey` しか無いので、両者は同じ並びのままである。
	 */
	const [viewedIndex, setViewedIndex] = useState<number | null>(null);
	const currentIndex = viewedIndex ?? initialIndex;
	const currentMediaId = feedIds.length > 0 ? (feedIds[Math.min(currentIndex, feedIds.length - 1)] ?? null) : null;
	const currentEntry = useDishMediaEntriesStore(selectEntryByMediaId(currentMediaId ?? ""));

	// m-1: 失敗と 0 件を区別し、失敗のほうにだけ再試行を出す。どちらの取得が失敗したかで
	// 叩き直す先を変える（行の取得なら `refreshRows`、メディアの取得なら該当キーの
	// エラー状態を消して effect の `!error` ガードを解く）
	const handleRetry = useCallback(() => {
		if (rowsError !== null) {
			refreshRows();
			return;
		}
		if (entriesKey !== null) {
			useDishMediaEntriesStore.getState().clearByKey(entriesKey);
			requestedKeyRef.current = null;
			setSettledKey(null);
		}
	}, [entriesKey, refreshRows, rowsError]);

	// ⚠️ ローディングは «まだ結果が出ていない» ときだけに絞ること。失敗しても止まる形にしないと
	// スピナーで固着する（`restaurant/[restaurantId]/feed.tsx` と同じ判断）。
	// #1375 実機確認（3 巡目）: `isActive` を条件に入れない。まだ前面に来ていない
	// （= 取得を始めていない）隣のページを «0 件 = 見つかりません» と誤表示すると、
	// 縦フリックの途中に「見つかりません」が挟まって壊れて見える。
	// 未取得はエラーでも 0 件でもなく «読み込み中» である
	const isFetchingRows = !hasFetchedRows && rowsError === null;
	const isHydratingMedia = mediaIds.length > 0 && settledKey !== hydrationKey && mediaError === null;
	const showLoading = feedIds.length === 0 && (isFetchingRows || isHydratingMedia);
	const hasError = rowsError !== null || mediaError !== null;
	// 「行は読めたが写真ありが 1 件も無い」は再試行の口を出さない 0 件表示
	const showEmpty = !showLoading && feedIds.length === 0 && !hasError;
	// m-1: 失敗はこちらだけ。「見つかりません」の 1 行で終わらせず再試行を出す
	const showError = !showLoading && feedIds.length === 0 && hasError;

	return (
		<View style={styles.container} testID={`my-dishes-feed-page-${feedScopeId(scope)}`}>
			{entriesKey !== null && feedIds.length > 0 ? (
				<>
					{/* ⚠️ `initialIndex` は «ids が確定してから» 渡す。DishMediaFeed は最初に届いた
					    非空の ids で並びを固定するので、ここで描き始める時点の index が最終値になる。
					    #1375 実機確認（2 巡目）: 日付スコープは **横** = 同じ日の別の投稿。
					    縦は外側のページャ（前後の «記録がある日»）が受け持つ */}
					<DishMediaFeed
						entriesKey={entriesKey}
						idType="dish_media"
						initialIndex={initialIndex}
						onIndexChange={setViewedIndex}
						horizontal={scope.kind === "date"}
					/>
					{/* #1375 実機確認（2 巡目）: «その日の何個目を見ているか» をストーリーズと同じ
					    セグメントバーで出す。件数が多い日はバーが細くなりすぎるので数字も添える */}
					{scope.kind === "date" && feedIds.length > 1 && (
						<View
							style={{ ...styles.positionContainer, top: Platform.OS === "ios" ? 48 : 8 }}
							pointerEvents="none"
							testID="my-dishes-feed-position">
							<View style={styles.positionBars}>
								{feedIds.map((id, index) => (
									<View key={id} style={[styles.positionBar, index === currentIndex && styles.positionBarActive]} />
								))}
							</View>
							<Text style={styles.positionCounter} testID="my-dishes-feed-position-counter">
								{`${Math.min(currentIndex + 1, feedIds.length)} / ${feedIds.length}`}
							</Text>
						</View>
					)}
					{/* #1397 (PR5/5) contextual filter chips。**`DishMediaFeed` の外側**に重ねるので、
					    店舗フィード・通知フィード・投稿フィードの振る舞いは一切変わらない（§10-1） */}
					{/* #1375 実機確認（3 巡目）: chips は **下部**へ。上部は日付インジケータと閉じるが居る */}
					<View style={{ ...styles.chipsContainer, bottom: 12 }} pointerEvents="box-none">
						<MyDishesFeedChips entry={currentEntry} />
					</View>
				</>
			) : showLoading ? (
				<View style={styles.centered} testID="my-dishes-feed-loading">
					<LoadingIndicator size="large" />
				</View>
			) : showError ? (
				<View style={styles.centered} testID="my-dishes-feed-error">
					<Text style={styles.emptyText}>{i18n.t("Common.errors.unexpected")}</Text>
					<TouchableOpacity
						testID="my-dishes-feed-retry"
						style={styles.retryButton}
						onPress={handleRetry}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Common.retry")}>
						<Text style={styles.retryText}>{i18n.t("Common.retry")}</Text>
					</TouchableOpacity>
				</View>
			) : showEmpty ? (
				<View style={styles.centered} testID="my-dishes-feed-empty">
					<Text style={styles.emptyText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			) : null}
		</View>
	);
});

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			// メディアを引き立てる固定黒のビューア背景（テーマで振らない）
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
			// 固定黒のビューアの上に載る文字なので固定の白でよい
			color: FixedColors.onMedia,
			textAlign: "center",
		},
		retryButton: {
			marginTop: 16,
			paddingHorizontal: 20,
			paddingVertical: 10,
			borderRadius: 20,
			backgroundColor: c.link,
		},
		retryText: {
			fontSize: 14,
			fontWeight: "600",
			// 地（retryButton = link の濃色）で塗り潰した上の文字なので固定でよい
			color: FixedColors.onFilled,
		},
		// chips の帯。閉じるボタン（zIndex: 10）と同じ高さに置き、重ならないよう
		// chips 側で右に余白を取っている（MyDishesFeedChips.tsx の `container`）
		chipsContainer: {
			position: "absolute",
			left: 0,
			right: 0,
			zIndex: 9,
		},
		// «その日の n 件目» のインジケータ。閉じるボタン（右上）と重ならないよう右へ余白を取る
		positionContainer: {
			position: "absolute",
			left: 16,
			right: 64,
			zIndex: 9,
			gap: 4,
		},
		positionBars: {
			flexDirection: "row",
			gap: 3,
		},
		positionBar: {
			flex: 1,
			height: 2,
			borderRadius: 1,
			backgroundColor: "rgba(255,255,255,0.35)",
		},
		positionBarActive: {
			// メディア（全画面 Feed）の上のインジケータなので固定の白でよい
			backgroundColor: FixedColors.onMedia,
		},
		positionCounter: {
			fontSize: 11,
			fontWeight: "700",
			color: "rgba(255,255,255,0.9)",
		},
	});
