import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * ⌨️ いま出ているソフトウェアキーボードの高さ（px）。出ていなければ 0。
 *
 * ## なぜ `KeyboardAvoidingView` だけでは足りないのか（#1629）
 *
 * オーナー実機報告「レビューの料金入力がキーボードに隠れる」は、
 * **`KeyboardAvoidingView` に `behavior` を渡す修正を配信したあとも直らなかった**。
 * 「直した」と報告したが実機では直っておらず、同じ報告を 2 度受けている。
 *
 * `KeyboardAvoidingView` は **自分の枠の位置と高さを測り、そこからキーボードまでの距離を
 * 引き算する**という前提で動く。この前提は Android では脆い。
 *
 * - Expo SDK 54 の Android は **edge-to-edge が強制**で、Android 15（API 35）以降は
 *   `adjustResize` が窓を縮めなくなった。以前 OS が肩代わりしていた «縮める» が消えた
 * - 枠の測定（`onLayout`）は親のレイアウトに依存する。入れ子のスクロールや
 *   高さを固定した親（`height: frame.height` 等）の中では、引き算の前提が崩れる
 *
 * つまり «画面ごとに効いたり効かなかったりする» 直し方であり、実際に効いていなかった。
 *
 * ## こちらの考え方
 *
 * **測るのはキーボードの高さだけ。**`Keyboard` のイベントが返す `endCoordinates.height` は
 * OS が報告する値で、窓が縮むかどうかにも親のレイアウトにも依存しない。
 * これを «下に空ける余白» として使えば、どの画面でも同じ結果になる。
 *
 * ⚠️ **これは «隠れない» ことしか保証しない。** «フォーカスした欄まで自動で運ぶ» のは
 *    スクロールビューの仕事で、そちらは呼び出し側が
 *    `keyboardShouldPersistTaps` などと合わせて組むこと。
 *
 * ⚠️ web では常に 0 を返す（`Keyboard` はイベントを発火しない）。
 */
export function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);

	useEffect(() => {
		if (Platform.OS === "web") return;

		/*
		iOS は `Will` 系を使う（アニメーションと同時に動かしたいため）。
		Android は `Will` 系が発火しないので `Did` 系を使う。
		*/
		const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const show = Keyboard.addListener(showEvent, (event) => {
			const height = event?.endCoordinates?.height ?? 0;
			// 負値や NaN を state へ入れない（レイアウトが壊れる）
			setInset(Number.isFinite(height) && height > 0 ? height : 0);
		});
		const hide = Keyboard.addListener(hideEvent, () => setInset(0));

		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	return inset;
}
