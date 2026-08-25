/*
このファイルの責務
- hapticsSettingsStore の値を React から読むためのフック。

useOnboardingSeen.ts と同じ理由で `useSyncExternalStore` を使う。書き手(設定画面のトグル)と
読み手(useHaptics を呼ぶ各画面)が別コンポーネントに分かれるため、購読を React 側の仕組みへ
任せておかないと、書いた瞬間に読み手が再描画される保証が無い。
*/
import { useEffect, useSyncExternalStore } from "react";

import { getHapticsEnabledSnapshot, loadHapticsEnabled, subscribeHapticsEnabled } from "../hapticsSettingsStore";

/** ハプティクス設定(オン/オフ)を購読する。読み込み前は既定値のオンを返す */
export function useHapticsEnabled(): boolean {
	// getServerSnapshot（第 3 引数）にも同じ関数を渡す。web の静的書き出し(expo export)では
	// サーバ側でも 1 度描画されるため、渡さないと "Missing getServerSnapshot" で落ちる
	const enabled = useSyncExternalStore(subscribeHapticsEnabled, getHapticsEnabledSnapshot, getHapticsEnabledSnapshot);

	useEffect(() => {
		// 多重呼び出しはストア側で 1 つの Promise に畳まれるので、
		// このフックを何箇所で使っても AsyncStorage の読み込みは 1 回だけ
		void loadHapticsEnabled();
	}, []);

	return enabled;
}
