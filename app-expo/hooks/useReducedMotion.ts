import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * #959 【設計】OS の「モーションを減らす」設定(iOS: 視差効果を減らす / Android: アニメーションを削除)に追従する。
 * native では AccessibilityInfo が唯一の取得手段のため、初期値は非同期取得までの間 false(通常表示)とする。
 * web 版(useReducedMotion.web.ts)は matchMedia(prefers-reduced-motion) を使う別実装。
 */
export function useReducedMotion(): boolean {
	const [reducedMotion, setReducedMotion] = useState(false);

	useEffect(() => {
		let isMounted = true;

		AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
			if (isMounted) setReducedMotion(enabled);
		});

		// #959 【設計】設定画面から戻ってきた場合など、アプリ起動中の変更にも追従する
		const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);

		return () => {
			isMounted = false;
			subscription.remove();
		};
	}, []);

	return reducedMotion;
}
