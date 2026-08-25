import { useCallback, useEffect, useRef, useState } from "react";

/*
#1375（実機: 「マップの画面がすごくクラッシュする」「性能劣化が治っていない」）

## 何が起きていたか

`react-native-maps` の `Marker` に **React の children を渡す**（= View Marker）と、
ネイティブ側はその View をビットマップへ焼いて地図に貼る。焼き直すかどうかを決めるのが
`tracksViewChanges` で、**既定値は `true`**（react-native-maps 1.20.1）。

`true` のままだと、Android の `MapMarker` は地図が動くあいだ中ずっと
`update()` → `getIcon()` → `createDrawable()` を呼び、**マーカー 1 個につき
毎フレーム 1 枚のビットマップを作り直す**。

このアプリの Map は 1 画面に最大 300 件（`MY_DISH_MAP_PINS_LIMIT`）のピンを置く。
300 個 × 毎フレームのビットマップ生成は、

- **性能**: pan / zoom が目に見えて重くなる（描画スレッドが焼き直しで埋まる）
- **クラッシュ**: 生成したビットマップが GC より速く積み上がり、
  ネイティブヒープを食い潰して落ちる（Java 例外を伴わない «突然終了» になる）

の両方を同時に起こす。オーナーの «すごいクラッシュする» と «性能劣化» は
別々の不具合ではなく、これ 1 つの症状である。

## どう直すか

**見た目が確定したら焼き直しを止める。** マーカーの絵が変わるのは

1. 初回のマウント（レイアウトが決まるまで）
2. 画像（`expo-image`）の読み込みが終わったとき
3. 色や選択状態が変わったとき（`signature` で表す）

の 3 つだけで、それ以外はいくら地図を動かしても絵は変わらない。
このフックは «変わりうる間だけ true、確定したら false» を返す。

## なぜ «確定した瞬間» ではなく少し待つのか

`onLoadEnd` / `onLayout` が返った時点では、まだその内容が RN のビューツリーへ
反映されていないことがある。そこで false にすると、**読み込み前の空の絵が
焼き付いたまま固定される**（= マーカーが白い丸のまま）。
兄弟実装（`AvatarBubbleMarkerBitmap`）が同じ理由で 250ms 待っており、
実績のある値なのでそれに揃える。

⚠️ この «待つ» を消さないこと。消すと画像が出ないマーカーが残る。
*/

/** 見た目が確定したと判断してから焼き直しを止めるまでの待ち時間（ms） */
export const MARKER_TRACKING_SETTLE_MS = 250;

/*
**画像が永久に返ってこない場合の保険。**

`onContentReady` は画像の `onLoadEnd` で呼ばれるが、`expo-image` にはタイムアウトが無い。
圏外に近い / 署名 URL が失効して応答が返らない / 画像ホストが落ちている、のいずれかで
`onLoadEnd` が来なければ、そのマーカーは **地図が動く限り毎フレーム焼き直され続ける**。
300 ピンの大半がその状態になれば、修正前とまったく同じ症状（重い・落ちる）へ戻る。

そこで «絵が出揃った合図» が来なくても、この時間で強制的に焼き直しを止める。
そのあと画像が遅れて届いても `signature` は変わらないので、
`onContentReady` が呼ばれて再び 250ms 後に確定し直すだけである（絵は正しく出る）。
*/
export const MARKER_TRACKING_MAX_WAIT_MS = 3_000;

export type MarkerViewTracking = {
	/** `Marker` の `tracksViewChanges` へそのまま渡す */
	tracksViewChanges: boolean;
	/** 絵が出揃ったときに呼ぶ（画像の `onLoadEnd`、画像が無いなら `onLayout`） */
	onContentReady: () => void;
};

/**
 * View Marker の焼き直しを «絵が変わりうる間» に限定する。
 *
 * @param signature 見た目を決める入力をまとめた文字列。変わると焼き直しを再開する
 *   （例: `${uri}|${color}|${isActive}`）。
 */
export function useMarkerViewTracking(signature: string): MarkerViewTracking {
	const [tracksViewChanges, setTracksViewChanges] = useState(true);
	const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimers = useCallback(() => {
		if (settleTimerRef.current !== null) {
			clearTimeout(settleTimerRef.current);
			settleTimerRef.current = null;
		}
		if (maxWaitTimerRef.current !== null) {
			clearTimeout(maxWaitTimerRef.current);
			maxWaitTimerRef.current = null;
		}
	}, []);

	/*
	見た目の入力が変わったら焼き直しを再開し、保険のタイマーを引き直す。

	⚠️ **初回は素通しする。** この effect はマウント時にも走るが、そこで `clearTimers()` を
	呼ぶと、画像がメモリキャッシュに当たって effect より **前** に `onLoadEnd` を
	発火させていた場合、予約済みの停止を取り消してしまう。以後 `onContentReady` を
	呼ぶ口は無いので、そのマーカーは焼き直しが止まらないまま残る。
	初回は state が既に `true` なので、やることは何も無い。
	*/
	const isFirstRunRef = useRef(true);
	useEffect(() => {
		if (isFirstRunRef.current) {
			isFirstRunRef.current = false;
		} else {
			clearTimers();
			setTracksViewChanges(true);
		}
		maxWaitTimerRef.current = setTimeout(() => {
			maxWaitTimerRef.current = null;
			setTracksViewChanges(false);
		}, MARKER_TRACKING_MAX_WAIT_MS);
		return () => {
			if (maxWaitTimerRef.current !== null) {
				clearTimeout(maxWaitTimerRef.current);
				maxWaitTimerRef.current = null;
			}
		};
	}, [clearTimers, signature]);

	// アンマウント後に setState しない
	useEffect(() => clearTimers, [clearTimers]);

	const onContentReady = useCallback(() => {
		clearTimers();
		settleTimerRef.current = setTimeout(() => {
			settleTimerRef.current = null;
			setTracksViewChanges(false);
		}, MARKER_TRACKING_SETTLE_MS);
	}, [clearTimers]);

	return { tracksViewChanges, onContentReady };
}
