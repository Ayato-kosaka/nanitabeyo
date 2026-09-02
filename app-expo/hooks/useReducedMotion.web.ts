import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** #959 【設計】SSR/古いブラウザで matchMedia が無い場合は通常表示(false)にフォールバック */
function getInitialReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * #959 【設計】native 版(useReducedMotion.ts)の web 実装。
 * ブラウザ/OS の prefers-reduced-motion 設定に matchMedia の change イベントで追従する。
 */
export function useReducedMotion(): boolean {
	const [reducedMotion, setReducedMotion] = useState(getInitialReducedMotion);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

		const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
		const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);

		mediaQueryList.addEventListener("change", handleChange);
		return () => mediaQueryList.removeEventListener("change", handleChange);
	}, []);

	return reducedMotion;
}
