/**
 * #1126 保存店カルーセル（横スクロール）と TrueSheet の縦ドラッグ（引き上げて縦並びへ展開）の
 * ジェスチャ競合を解消するための設定値と判定ロジック。
 *
 * ■ 競合の根因
 * Android の TrueSheet は Material の `BottomSheetBehavior` + `ViewDragHelper` で実装されている。
 * `ViewDragHelper.checkTouchSlop()` は BottomSheetBehavior が「縦にしかドラッグできない」ため
 * `abs(dy) > touchSlop` だけを見る。つまり **横の移動量と比較しない**。
 * touchSlop は `ViewConfiguration.getScaledTouchSlop()` ＝ 8dp しかないので、
 * カルーセルを横スワイプしているだけでも指が 8dp 縦にぶれた瞬間に
 * CoordinatorLayout がタッチを横取りし（子には ACTION_CANCEL が飛ぶ）、シートが展開してしまう。
 *
 * ■ 方針
 * 1. カルーセル側の Pan を「横方向専用」にする（`activeOffsetX` / `failOffsetY`）。
 *    しきい値を上げるのではなく、方向で排他にする。
 * 2. 横スワイプが成立している間だけ TrueSheet の `draggable` を false にして、
 *    Android のネイティブ側にシートを掴ませない。
 *    縦へ引いた場合はカルーセルが fail するので `draggable` は true のままで、従来どおり展開できる。
 */

/**
 * カルーセルの Pan が「横スワイプ」として活性化するのに必要な横方向の移動量（dp）。
 *
 * react-native-reanimated-carousel の既定は「向き無指定・半径 10dp」なので、
 * 縦ドラッグでもカルーセルが活性化していた。閾値の大きさは 10dp のまま、
 * 判定対象を横方向だけに絞ることで、タップの取りこぼしを増やさずに方向を排他化する。
 */
export const CAROUSEL_ACTIVE_OFFSET_X = 10;

/**
 * カルーセルの Pan を「縦ジェスチャなので降りる（fail）」と判断する縦方向の移動量（dp）。
 *
 * `CAROUSEL_ACTIVE_OFFSET_X` の 2 倍にして横方向を優先する。
 * また Android のシートが掴む閾値（touchSlop = 8dp）より必ず大きくしておくことで、
 * 意図的な縦ドラッグでは「シートが掴む → カルーセルが fail」の順になり、展開操作が壊れない。
 */
export const CAROUSEL_FAIL_OFFSET_Y = 20;

/**
 * #644 で導入した「`onScrollEnd` が来ずにドラッグ中フラグが立ちっぱなしになる」ことへの
 * フォールバックのタイムアウト（ms）。#1126 のシートドラッグ抑止も同じタイマーで解除する。
 */
export const CAROUSEL_DRAG_RESET_TIMEOUT_MS = 500;

/**
 * `configureCarouselPanGesture` が必要とする最小限の面。
 *
 * #1156 で react-native-reanimated-carousel が v5 へ上がり、`onConfigurePanGesture` へ渡るのが
 * RNGH の `PanGesture` そのものではなく、それを包んだ `CarouselPanGesture`（`enabled` や
 * `runOnJS` のような所有権を変える API を隠したファサード）になった。
 * どちらか一方の型を import すると、もう一方を渡せなくなる（メソッドの戻り値が自分自身の型のため）。
 * ここで必要なのは 2 メソッドだけなので、構造だけを要求して両方を受けられるようにしておく。
 */
type CarouselDirectionalPanGesture<G> = {
	activeOffsetX(offset: [start: number, end: number]): G;
	failOffsetY(offset: [start: number, end: number]): G;
};

/**
 * カルーセルの Pan ジェスチャを横方向専用に設定する。
 *
 * - 横へ `CAROUSEL_ACTIVE_OFFSET_X` dp 動くまで活性化しない
 * - 先に縦へ `CAROUSEL_FAIL_OFFSET_Y` dp 動いたら fail して縦ジェスチャへ譲る
 */
export function configureCarouselPanGesture<G extends CarouselDirectionalPanGesture<G>>(gesture: G): void {
	gesture
		.activeOffsetX([-CAROUSEL_ACTIVE_OFFSET_X, CAROUSEL_ACTIVE_OFFSET_X])
		.failOffsetY([-CAROUSEL_FAIL_OFFSET_Y, CAROUSEL_FAIL_OFFSET_Y]);
}

/**
 * TrueSheet にドラッグを許可してよいかを判定する。
 *
 * @param detentIndex 現在の detent（0 = 横並びカルーセル / 1 = 縦並びリスト）
 * @param isSwipingCarousel カルーセルの横スワイプが成立中か
 * @returns 横スワイプ中のカルーセル表示時だけ false（＝シートを掴ませない）
 */
export function isSheetDraggable(detentIndex: number, isSwipingCarousel: boolean): boolean {
	// 展開後（detentIndex !== 0）はカルーセルが存在しないので、常にドラッグ可能にしておく
	if (detentIndex !== 0) return true;
	return !isSwipingCarousel;
}
