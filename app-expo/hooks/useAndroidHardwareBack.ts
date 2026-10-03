import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

/**
 * #1961 【設計】Android の **システムの戻る**（画面下の戻る / 端からのスワイプ）を、
 * 画面が持っている «戻る導線» へ繋ぐ。
 *
 * ## なぜ要るか
 *
 * 共有リンクなどでスタックが 1 枚しか無い状態へ着地すると、システムの戻るは
 * ナビゲータが処理し、**pop 先が無いので OS がアプリごと終了する**。画面側に
 * `router.canDismiss()` のフォールバック（履歴が無ければタブへ replace）を書いても、
 * それは `onPressBack`（ヘッダーの戻るボタン）にしか繋がっておらず**呼ばれない**。
 *
 * `#1386` の設計（`e2e-mobile/tests/my-dishes/restaurant-routes.test.ts` に
 * 「Android はハードウェアバック …（中略）… 食べたい/食べたタブへ倒れる」として
 * 固定されている）は、ヘッダーのボタンだけでなく**システムの戻るも含む**。
 *
 * ## 使い方
 *
 *     useAndroidHardwareBack(handleBack);
 *
 * ⚠️ **必ず `true` を返して既定の pop を止める。** `false` を返すと、こちらの
 * フォールバックが走ったあとに OS の終了まで走る。
 *
 * ⚠️ **同じ画面で 2 回呼ばない。** `BackHandler` は後から登録した方が先に呼ばれる
 * （LIFO）ので、2 つ登録すると «どちらが効くか» がマウント順に依存する。
 *
 * @param onBack 戻るときに実行する処理。`undefined` を渡すと何も登録しない
 *   （条件付きで無効化したい画面のため）。
 */
export function useAndroidHardwareBack(onBack: (() => void) | undefined): void {
	useEffect(() => {
		if (Platform.OS !== "android") return;
		if (!onBack) return;

		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			onBack();
			return true;
		});
		return () => subscription.remove();
	}, [onBack]);
}
