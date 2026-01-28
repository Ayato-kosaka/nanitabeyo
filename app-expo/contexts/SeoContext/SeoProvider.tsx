/**
 * SEO管理用Provider
 *
 * - defaults: デフォルトSEO値（locale変更時に更新される）
 * - stack: ページごとの上書き値（mount時push、unmount/blur時pop）
 * - current: defaults + stackTopの最終結果
 *
 * #717 【設計】Head出力を1箇所に集約し、重複・残留を防止
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export type SeoData = {
	title: string;
	description: string;
	image: string;
	imageAlt: string;
	robots?: string;
	siteName?: string;
};

export type SeoOverride = {
	id: string;
	data: Partial<SeoData>;
};

type SeoContextValue = {
	defaults: SeoData;
	current: SeoData;
	push: (seoOverride: SeoOverride) => void;
	pop: (id: string) => void;
};

const SeoContext = createContext<SeoContextValue | undefined>(undefined);

type SeoProviderProps = {
	children: ReactNode;
	initialDefaults: SeoData;
};

export function SeoProvider({ children, initialDefaults }: SeoProviderProps) {
	const [defaults, setDefaults] = useState<SeoData>(initialDefaults);
	const [stack, setStack] = useState<SeoOverride[]>([]);

	// #717 【設計】initialDefaults が変更されたら defaults を更新（locale変更時など）
	useEffect(() => {
		setDefaults(initialDefaults);
	}, [initialDefaults]);

	// #717 【設計】同一IDでの上書き更新を可能にする（既存を削除してから追加）
	const push = useCallback((seoOverride: SeoOverride) => {
		setStack((prev) => {
			const filtered = prev.filter((item) => item.id !== seoOverride.id);
			return [...filtered, seoOverride];
		});
	}, []);

	// #717 【設計】unmount/blur時にスタックから削除して上書きを解除
	const pop = useCallback((id: string) => {
		setStack((prev) => prev.filter((item) => item.id !== id));
	}, []);

	// #717 【設計】defaults + stackTopをマージして現在のSEO値を算出
	const current: SeoData = {
		...defaults,
		...(stack.length > 0 ? stack[stack.length - 1].data : {}),
	};

	return <SeoContext.Provider value={{ defaults, current, push, pop }}>{children}</SeoContext.Provider>;
}

export function useSeoContext() {
	const context = useContext(SeoContext);
	if (!context) {
		throw new Error("useSeoContext must be used within SeoProvider");
	}
	return context;
}
