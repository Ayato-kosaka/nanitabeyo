// このコンポーネントは、縦方向の全画面ページングで DishMediaEntry を表示するフィードです。
// 設計思想：
// - 1ページ = 画面の高さ（SafeArea等を含む実測値）で固定し、各セルは高さ pageHeight に揃える
// - 初期表示位置は initialIndex を採用。ただしレイアウト確定前は失敗し得るため、保険として contentOffset も併用
// - 現在の表示インデックスは FlatList の viewability（itemVisiblePercentThreshold=90%）で決定
// - レイアウト計測（onLayout）が発火して pageHeight が確定した後に初期スクロール/再配置を行う
// 責務分離：
// - 高さ計測: <View onLayout> -> pageHeight（state）
// - スクロール命令: listRef.scrollToIndex / contentOffset（初回のみ）
// - 表示中インデックス管理: currentIndex（state） + currentIndexRef（最新値ミラー）
// - 副作用（ログ/ハプティクス/analytics）: onViewableItemsChanged 内でのみ実行

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { StyleSheet, FlatList, ViewToken, View, ListRenderItemInfo } from "react-native";
import DishMediaContent from "./DishMediaContent";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { generateUUID } from "@/lib/uuid";
import {
	DishMediaEntriesStore,
	NormalizedDishMediaEntry,
	selectIdsByKey,
	useDishMediaEntriesStore,
	IdType,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { Text } from "react-native";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useDishMediaBackgroundImageResources } from "@/features/dishMedia/hooks/useDishMediaBackgroundImageResources";
// #1509 全画面フィードの黒背景・白文字はメディアを引き立てる固定色（テーマ非追従）
import { FixedColors } from "@/constants/Palette";
import { ErrorBoundary } from "@/components/ErrorBoundary";
// #1629【30】先読みの «窓» の判断はここに閉じている（テストから直接叩けるようにするため）
import { computePreloadIds } from "@/features/dishMedia/preloadWindow";

// --- ユーティリティ群（純粋関数） ------------------------------------------
// インデックスを items.length の範囲内にクランプ
const clampIndex = (index: number, length: number) => Math.min(Math.max(0, index), Math.max(0, length - 1));

// --- Props -------------------------------------------------------------------

interface DishMediaFeedProps {
	// 初期表示インデックス（範囲外はクランプ）
	initialIndex?: number;
	// 表示中インデックスが変化した際のコールバック
	onIndexChange?: (index: number) => void;
	// 各アイテムのタイトル取得関数
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	// 呼び出し元コンテキスト（画面用途キー）
	entriesKey: string;
	// ID の種類（dish_media / dish_reviews）
	idType: IdType;
	// #1375 横ページングにする（my-dishes の日付 Feed 用）。既定 false = 従来どおり縦。
	// 既存の呼び出し元（検索結果・店舗・通知・投稿）は渡さないので挙動は変わらない
	horizontal?: boolean;
	/*
	#1641【オーナー実機報告 2026-08-31】**この Feed が «前面のページ» に居るかどうか。**

	報告は 3 件とも «押したカードの次の音が鳴る» だった。

	    ホンデポチャ（3番目）を押す → 4番目（Instagram）の音が鳴る
	    麦と麺助（4番目 / Instagram）を押す → 5番目（YouTube）の音が鳴る
	    YouTube から上へスクロール → YouTube の音が鳴り続ける

	真因は **外側のページャ**にあった。グリッド由来のフィードは
	**1 ページ = グリッドの 1 セル**で、各ページの ids は必ず 1 件。つまりページの中では
	常に `index(0) === currentIndex(0)` なので、**マウントした瞬間に再生が始まる**。
	そこへ #1629 の先読み（`shouldPrefetch={index === activeScopeIndex + 1}`）が
	**隣のページの取得を開ける**ので、隣のページも描かれ、そのまま鳴っていた。

	⚠️ **`index === currentIndex` だけで «前面» を決めてはいけない。** それは
	   «このリストの中で何番目か» でしかなく、**このリスト自体が前面に居るか**は別である。
	   `screenFocused`（ルート単位）でも分けられない。同じルートの中の別ページだから。

	既定 true。渡さない呼び出し元（検索結果・店舗・通知・投稿）の挙動は変わらない。
	*/
	isScreenActive?: boolean;
	/*
	#1752 **メディアを持たないページを混ぜるための差し込み口（オプトイン）。**

	my-dishes のフィードには «写真の無い記録»（写真を消した記録を含む）が混ざる。
	それらは `dish_media.id` を持たないので、この Feed の並び（= ストアの ids）には
	原理的に載らず、**黙って落ちていた**（オーナー実機報告: Calendar の日付が
	「見つかりません」／ Map の «食べた 3 件» がフィードでは 2 件）。

	そこで «その位置に別の中身を描く» ことだけを外から差せるようにする。

	- `ids` … 合成 id の集合。**エントリを持たない**ので、背景画像の先読みからは必ず外す
	- `order` … ストアの ids を受け取り、合成 id を混ぜた **最終的な並び**を返す
	  （どこへ挟むかは呼び出し元にしか分からない。ここでは «末尾に足す» と決め打たない）
	- `render` … その合成 id のページの中身

	⚠️ 渡さない呼び出し元（検索結果・店舗・通知・投稿）の挙動は 1 ミリも変わらない。
	⚠️ `order` / `render` は **memo 化して渡すこと**。毎レンダー作り直すと並びの再計算が走る。
	*/
	customPages?: {
		ids: string[];
		order: (liveIds: string[]) => string[];
		render: (id: string) => React.ReactNode;
	};
}

// --- 本体 --------------------------------------------------------------------
export default function DishMediaFeed({
	initialIndex = 0,
	onIndexChange,
	getTitle,
	entriesKey,
	idType,
	horizontal = false,
	isScreenActive = true,
	customPages,
}: DishMediaFeedProps) {
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey, idType],
	);
	const { ids: storeIds, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	/*
	#1752 合成ページを混ぜた «この画面が並べるべき順». 渡されていなければストアの並びそのもの。
	以降このファイルは `liveIds` しか見ない（合成 id もページとして等しく扱うため）。
	*/
	const customIds = customPages?.ids;
	const customOrder = customPages?.order;
	const customIdSet = useMemo(() => new Set(customIds ?? []), [customIds]);
	const liveIds = useMemo(() => (customOrder ? customOrder(storeIds) : storeIds), [customOrder, storeIds]);

	// 画面を開いた時点の並びを固定するための state
	// liked/unlike 等のリアルタイム反映は行わない
	const [ids, setIds] = useState<string[]>([]);
	/*
	#1629【35】【設計】**固定した並びから «削除されたもの» だけは落とす。**

	オーナー報告「投稿を削除するとローディングの無限ループになる」の真因がここだった。
	並びを固定したあとは `liveIds` が縮んでもこの state は縮まないので、削除したセルが
	FlatList に残る。残ったセルは `entriesByMediaId` から実体が消えているため
	`useDishMediaBackgroundImageResources` の descriptor から外れ、背景画像の状態が
	`idle` のまま二度と動かない。`DishMediaContent` は idle を «読み込み中» と見なして
	`SkeletonShimmer` を出し続けるので、**削除した投稿の上でスケルトンが回り続ける**。

	⚠️ 判定に `liveIds` を使わないこと。`clearByKey`（画面を離れるときの掃除）でも
	   `liveIds` は空になるので、それを «削除» と読むと関係のない場面でフィードが空になる。
	   見るのは削除操作だけが立てる墓標（`useDishMediaEntriesStore.deletedIds`）である。
	*/
	const deletedIds = useDishMediaEntriesStore((state) => state.deletedIds);
	/*
	#1629【40】【設計】**背景画像の «セッション» は、並びの文字列ではなく «この画面を開いた 1 回»。**

	オーナー実機報告（2026-08-28 / OTA `553f8763`）:

	> 削除したら **次の投稿** が無限ローディングになった

	【35】で «削除したセル» は並びから落としたのに、今度は隣が読み込み中のままになった。
	原因は `backgroundImagesSessionKey` に `ids.join(",")` を混ぜていたことである。
	1 件消えるだけでセッションキーが変わり、`useDishMediaBackgroundImageResources` が
	**読み終わっている画像を 1 枚残らず release して取り直す**（`resetImageStates`）。
	取り直しの間、残ったセルは `idle` → `loading` に落ちるので、**次の投稿が
	スケルトンに戻る**。取り直しはネイティブ側の解放と同時に走るため、実機では
	戻ってこないことがある（＝ローディングが終わらない）。

	並びが 1 件縮んだだけなら、それは同じセッションの続きである。**種を播き直した
	ときだけ** 世代を進める（下の `setIdsSession`）。
	*/
	const [idsSession, setIdsSession] = useState(0);
	useEffect(() => {
		if (ids.length === 0) {
			if (liveIds.length > 0) {
				setIds(liveIds);
				setIdsSession((session) => session + 1);
			}
			return;
		}
		if (!ids.some((id) => deletedIds[id])) return;
		setIds((prev) => prev.filter((id) => !deletedIds[id]));
	}, [liveIds, ids, deletedIds]);

	// #802 【責務分離】Feed は ids とページング制御だけを担い、背景画像 preload の最小購読は hook に閉じる。
	// #1629【40】⚠️ ここへ `ids.join(",")` を戻さないこと（上の `idsSession` の設計コメント）
	const backgroundImagesSessionKey = useMemo(
		() => `${entriesKey}::${idType}::${idsSession}`,
		[entriesKey, idType, idsSession],
	);

	// 命令的スクロール用の List 参照
	const listRef = useRef<FlatList<string>>(null);

	// 実レイアウト高（SafeArea等込み）: onLayout で初回確定
	const [pageHeight, setPageHeight] = useState(0);
	// #1375 横ページング時のページ幅。縦のときは使わない
	const [pageWidth, setPageWidth] = useState(0);
	// ページ 1 枚ぶんのスクロール量。横なら幅、縦なら高さ
	const pageLength = horizontal ? pageWidth : pageHeight;

	// initialIndex を常に範囲内へ
	const clampedInitialIndex = useMemo(() => clampIndex(initialIndex, ids.length), [initialIndex, ids.length]);

	// 現在の表示インデックス（状態）＋最新値ミラー用Ref（Viewabilityコールバックで参照）
	const [currentIndex, setCurrentIndex] = useState(clampIndex(initialIndex, ids.length));

	/*
	#1641 **並びが届いた時点で `currentIndex` を `initialIndex` へ合わせる。**

	⚠️ `useState` の初期化子では合わせられない。`ids` は `useState([])` なので、
	   初期化子が走る時点で必ず `ids.length === 0` であり、
	   `clampIndex(initialIndex, 0)` は **0 を返す**。つまり `initialIndex` を
	   いくつ渡しても、最初は必ず 0 番目が前面扱いになる。

	影響: `initialIndex > 0` で開く画面（店舗フィード / 通知フィード / 日付・店舗スコープ）で、
	viewability が初めて鳴る（`minimumViewTime` 200ms）まで **0 番目のセルが再生される**。
	`initialIndex` が窓の内側なら、その 0 番目は実際にマウントされて音が出る。

	⚠️ ここで «毎回» 合わせないこと。ユーザーが送ったあとに戻してしまう。
	   並びが確定した最初の 1 回だけ（`syncedSessionRef`）にする。
	*/
	const syncedSessionRef = useRef(0);
	useEffect(() => {
		if (idsSession === 0 || syncedSessionRef.current === idsSession) return;
		syncedSessionRef.current = idsSession;
		setCurrentIndex(clampedInitialIndex);
	}, [idsSession, clampedInitialIndex]);

	// #802 / 独立レビュー指摘（High）: preload は **currentIndex の周辺だけ**に絞る。
	// 以前は ids 全件（my-dishes 経由だと最大 42 件）を同時に `Image.loadAsync` しており、
	// 開いた瞬間に全画面ビットマップ 42 枚の取得・デコードが一斉に走っていた
	// （Android は Glide 側の timeout も踏む）。窓の外は表示時に通常経路で読まれる
	/*
	#1629 【調整 → 一部差し戻し】背景画像の先読み。

	## 重さの正体と、クラッシュの正体は別物である

	«1 個ずつ読み込む感じ» の正体は **次のカードの背景画像をスワイプ後に取りに行くこと**、
	«先読みしすぎるとクラッシュ» の正体は **動画デコーダの同時本数**（`isNearActive` が ±1 で
	別に握っている）。だから広げる先を分ける。`windowSize` は 5 のまま（前後 2 ページのマウント）。

	## ⚠️ 件数が少ない画面では «窓» そのものが害になる（オーナー実機報告）

	> このお店提案は 5 件しか表示されないんで、今の状態だとチカチカするんですよね。
	> 今までこのお店提案はそんな性能が悪かったことないんで、そういう先読みは
	> あえて入れてないんですよ。むしろチカチカして見にくい。

	`useDishMediaBackgroundImageResources` は **集合から外れた画像を release する**。
	窓を動かすと、外れた画像は破棄され、戻ってきたときに取り直しになる。
	件数が窓より少し多いだけの画面（お店提案は 5 件）では、指を動かすたびに
	**取得 → 破棄 → 取得** が繰り返され、これが «チカチカ» の正体である。
	枚数を 4 から 2 へ減らしても、窓が動く限り churn は消えない。

	そこで **全部が窓に収まる規模なら窓を作らない**。1 度きりで確定するので churn がゼロになる。
	これは release/1.13 の «ids 全件を渡す» 挙動と、この規模では同一である。

	⚠️ 大きい方（my-dishes 経由の 42 件）を «全件先読み» へ戻さないこと。#802 の時点で
	   全画面ビットマップ 42 枚の取得・デコードが一斉に走り、Android では Glide の
	   timeout まで踏んでいた。だから **しきい値で分ける**のであって、窓をやめるのではない。
	*/
	/*
	#1752 ⚠️ **合成ページの id を先読みへ渡さないこと。** あちらは `entriesByMediaId` に実体が
	無いので、渡すと «読めない画像» として descriptor に載り、release / 取り直しの churn を
	増やすだけになる（#1629【40】でスケルトンが回り続けた経路と同じ）。
	*/
	const preloadIds = useMemo(
		() => computePreloadIds(ids, currentIndex).filter((id) => !customIdSet.has(id)),
		[ids, currentIndex, customIdSet],
	);
	const { getBackgroundImageState } = useDishMediaBackgroundImageResources({
		ids: preloadIds,
		idType,
		sessionKey: backgroundImagesSessionKey,
	});
	/*
	#1629【40】**並びが縮んだら表示位置を並びの中へ戻す。**

	末尾の投稿を削除すると `ids.length` が 1 減り、`currentIndex` は viewability が
	鳴るまで «存在しない位置» を指す。その間はどのセルも `index === currentIndex` に
	ならないので **動画が 1 本も再生されない**（`isActive` が全部 false）。
	先読みの窓も存在しない位置を中心に計算される（`computePreloadIds` 側でも丸めている）。
	*/
	useEffect(() => {
		if (ids.length === 0) return;
		const last = ids.length - 1;
		if (currentIndex <= last) return;
		setCurrentIndex(last);
		onIndexChange?.(last);
	}, [ids.length, currentIndex, onIndexChange]);

	const currentIndexRef = useRef(currentIndex);
	useEffect(() => {
		currentIndexRef.current = currentIndex;
	}, [currentIndex]);

	// items の参照も最新をミラー（onViewableItemsChanged内で安定参照するため）
	const itemsRef = useRef(ids);
	useEffect(() => {
		itemsRef.current = ids;
	}, [ids]);

	// 付随機能（ハプティクス・ログ）
	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// 一意なセッションID（DishMediaContent へ伝搬）
	const sessionId = useRef(generateUUID());

	// --- ライフサイクルログ（初回） ------------------------------
	useEffect(() => {
		logFrontendEvent({
			event_name: "food_feed_mounted",
			error_level: "log",
			payload: {
				itemCount: ids.length,
				initialIndex,
				hasItems: ids.length > 0,
				impl: "FlatList",
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// --- getItemLayout（ページ長=画面高 or 画面幅; 初期スクロール安定化の要） --------
	const getItemLayout = useMemo(
		() => (_: ArrayLike<string> | null | undefined, index: number) => ({
			length: pageLength ?? 0,
			offset: (pageLength ?? 0) * index,
			index,
		}),
		[pageLength],
	);

	/*
	--- viewability 閾値（90%以上を“表示中”とみなす） -----------------------

	#1641 ⚠️ **`minimumViewTime` を外さないこと。**

	オーナー報告（実機 2026-08-30）2 件の真因がこれだった:

	  - 「先読みで、下のフィードの音が聞こえてしまったりする」
	  - 「フィードを上下すると TikTok / YouTube が起動しないときがある」

	`pagingEnabled` + `decelerationRate="fast"` で勢いよく送ると、**通り過ぎるだけのセルも
	一瞬 90% 可視になり** viewability が鳴る。そのたびに `currentIndex` が動くので、

	  1. 着地していないセルの `ExternalEmbedPlayer` が `isActive` でマウントし、
	     WebView が読み込みを始めて **鳴り出す**（＝「下のフィードの音」）
	  2. 1 回のフリックで WebView が何枚も生まれては捨てられ、着地したセルの読み込みが
	     そのぶん遅れる・競合する（＝「起動しないときがある」）

	`minimumViewTime` は **«その位置に留まったか» を待つための RN 公式の口**である。
	通過しただけのセルはここで落ちるので、上の 2 つが同時に消える。

	⚠️ 大きくしすぎないこと。ここは «再生が始まるまでの時間» に直に効く（オーナー指摘
	「ロード完了から動画が出るまで黒い」の一部でもある）。埋め込みの読み込みは数秒かかるので
	200ms は体感に出ないが、500ms を超えると «送ったのに始まらない» に変わる。
	*/
	const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 90, minimumViewTime: 200 }), []);

	// --- onViewableItemsChanged（公式推奨：useRef直渡し） ----------------------
	// 責務: 表示中インデックスの同定・副作用（ハプティクス/ログ/通知）
	const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
		const v = viewableItems.find((t) => t.isViewable);
		if (v?.index == null) return;

		const prev = currentIndexRef.current;
		if (v.index === prev) return;

		// 状態更新
		setCurrentIndex(v.index);
		// 外部通知
		onIndexChange?.(v.index);
		// 触覚フィードバック
		selectionChanged();

		// ログ出力（items は ref 経由で最新を参照）
		const item = itemsRef.current[v.index];
		logFrontendEvent({
			event_name: "food_feed_swipe",
			error_level: "log",
			payload: {
				fromIndex: prev,
				toIndex: v.index,
				direction: v.index > prev ? "down" : "up",
				currentItemId: item,
			},
		});
	}).current;

	// --- renderItem（再レンダを抑制：pageHeight にのみ依存） -------------------
	const renderItem = useCallback(
		({ item, index }: ListRenderItemInfo<string>) => (
			// 各ページは厳密に画面サイズに合わせる（横のときは幅も固定しないとページングが崩れる）
			<View style={{ height: Math.max(1, pageHeight), ...(horizontal ? { width: Math.max(1, pageWidth) } : {}) }}>
				{/* #1375（5 巡目・安定性）**セル単位の ErrorBoundary。**
				    `DishMediaContent` は entry が引けないと throw する設計（同ファイル冒頭のコメント）だが、
				    その境界は検索結果のカルーセル（`DishMediaMap.tsx:315`）にしか無く、
				    このフィード（my-dishes / 店舗 / 通知 / 投稿 / プロフィール）から throw すると
				    **アプリ全体の ErrorBoundary まで抜けて «全画面エラー → トップへ戻る»** になっていた。
				    ユーザーからは «落ちた» と区別がつかない。1 セルの再試行に閉じ込める。
				    ⚠️ throw を残すか消すかは別論点。まず境界を `DishMediaMap` と揃える */}
				<ErrorBoundary>
					{/* #1752 メディアを持たないページ（my-dishes の «写真の無い記録»）。
					    ストアにエントリが無いので `DishMediaContent` の手前で分ける。
					    ⚠️ 再生の話（`isActive` / `isNearActive`）はこちらには要らない。鳴るものが無い */}
					{customIdSet.has(item) ? (
						customPages?.render(item)
					) : (
						<DishMediaContent
							id={item}
							/*
							#1641 ⚠️ **`isScreenActive` を外さないこと。** これが無いと、
							先読みで開いた隣のページが «自分の中では 0 番目 ＝ 前面» と判断して鳴る
							（グリッド由来のページは ids が 1 件なので必ずそうなる）。
							オーナー実機で «押したカードの次の音が鳴る» として 3 回報告された。
							*/
							isActive={isScreenActive && index === currentIndex}
							// #1375（5 巡目・性能 B-2）動画プレイヤーは «見えている ±1» だけ実体化する。
							// windowSize={5} は前後 2 ページぶんをマウントするので、素直に描くと
							// 同時に 5 本のデコーダが立つ。±1 は先読み（スワイプ直後の黒画面を出さない）
							isNearActive={Math.abs(index - currentIndex) <= 1}
							getTitle={getTitle}
							sessionId={sessionId.current}
							entriesKey={entriesKey}
							idType={idType}
							backgroundImageState={getBackgroundImageState(item)}
						/>
					)}
				</ErrorBoundary>
			</View>
		),
		[
			pageHeight,
			pageWidth,
			horizontal,
			currentIndex,
			getTitle,
			entriesKey,
			idType,
			getBackgroundImageState,
			isScreenActive,
			customIdSet,
			customPages,
		],
	);

	return (
		<View
			style={styles.root}
			// #1629【35】回帰テストが onLayout を発火させて FlatList を描くための口
			testID="dish-media-feed-root"
			// ここで SafeArea 等込みの実レイアウト高を取得し pageHeight に反映
			onLayout={(e) => {
				const h = Math.max(1, Math.floor(e.nativeEvent.layout.height));
				if (h !== pageHeight) setPageHeight(h);
				const w = Math.max(1, Math.floor(e.nativeEvent.layout.width));
				if (w !== pageWidth) setPageWidth(w);
			}}>
			{/* ページ寸法が確定するまでは描画を遅延（初期スクロール不発を防止） */}
			{pageLength > 0 && pageHeight > 0 ? (
				!!isLoading ? (
					<View style={styles.centerContainer}>
						<LoadingIndicator size="large" />
						<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
					</View>
				) : !!error ? (
					<View style={styles.centerContainer}>
						<Text style={styles.errorText}>{error}</Text>
					</View>
				) : ids.length > 0 ? (
					<FlatList
						// ページ寸法が変わったときはリマウントさせたいため key を付ける
						key={`${entriesKey}-${pageLength}`}
						horizontal={horizontal}
						ref={listRef}
						data={ids}
						renderItem={renderItem}
						keyExtractor={(id) => id}
						style={styles.list}
						// ページング：1画面=1ページ
						pagingEnabled
						// 既存方針：initialScrollIndex はレイアウト後の scrollToIndex と併用
						initialScrollIndex={clampedInitialIndex}
						// 初期スクロール安定化（高さが一定である前提）
						getItemLayout={getItemLayout}
						// 視覚ノイズの低減
						showsVerticalScrollIndicator={false}
						// ページング感の強化
						decelerationRate="fast"
						// パフォーマンス調整（既存値を踏襲）
						windowSize={5}
						maxToRenderPerBatch={3}
						// 表示中確定ハンドラ（関数インスタンスは固定）
						onViewableItemsChanged={onViewableItemsChanged}
						// 失敗時の再試行（既存挙動を保持）
						onScrollToIndexFailed={({ index, highestMeasuredFrameIndex, averageItemLength }) => {
							setTimeout(() => {
								listRef.current?.scrollToIndex({ index, animated: false });
							}, 250);
						}}
						// 可視閾値 = 90%
						viewabilityConfig={viewabilityConfig}
					/>
				) : null
			) : null}
		</View>
	);
}

// --- Styles ------------------------------------------------------------------
const styles = StyleSheet.create({
	// ルートは常に黒背景（SafeAreaや余白での色抜け防止）
	root: {
		flex: 1,
		backgroundColor: FixedColors.mediaBackground,
	},
	list: {
		flex: 1,
		backgroundColor: FixedColors.mediaBackground, // メディアを引き立てる黒背景
	},
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: FixedColors.mediaBackground,
	},
	loadingText: {
		marginTop: 16,
		color: FixedColors.onMedia,
		fontSize: 16,
	},
	errorText: {
		color: FixedColors.errorOnMedia,
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
});
