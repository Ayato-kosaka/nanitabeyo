/*
このファイルの責務
- onboardingSeenStore の値を React から読むためのフック。

`useState` + `useEffect` ではなく `useSyncExternalStore` を使うのは、
**別のコンポーネントが書いた値**を取りこぼさないため。Welcome 画面（書き手）と
検索画面・Meta 初期化（読み手）は別ツリーに居るので、購読を React 側の仕組みへ
任せておかないと、書いた瞬間に読み手が再描画される保証が無い。
*/
import { useEffect, useSyncExternalStore } from "react";

import { getOnboardingSeenSnapshot, loadOnboardingSeen, subscribeOnboardingSeen } from "../onboardingSeenStore";

/**
 * オンボーディングの既読状態を購読する。
 *
 * @returns `null` … まだ読み込んでいない（**どちらとも判定してはいけない**）/
 *          `true` … 既読 / `false` … 未読
 */
export function useOnboardingSeen(): boolean | null {
	// getServerSnapshot（第 3 引数）にも同じ関数を渡す。web の静的書き出し（expo export）では
	// サーバ側でも 1 度描画されるため、渡さないと "Missing getServerSnapshot" で落ちる
	const seen = useSyncExternalStore(subscribeOnboardingSeen, getOnboardingSeenSnapshot, getOnboardingSeenSnapshot);

	useEffect(() => {
		// 多重呼び出しはストア側で 1 つの Promise に畳まれるので、
		// このフックを何箇所で使っても AsyncStorage の読み込みは 1 回だけ
		void loadOnboardingSeen();
	}, []);

	return seen;
}
