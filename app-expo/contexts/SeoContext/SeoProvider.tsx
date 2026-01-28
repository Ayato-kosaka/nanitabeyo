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

function normalizeOverride(data: Partial<SeoData>): Partial<SeoData> {
	const out: Partial<SeoData> = {};

	const putText = (key: keyof SeoData, v: unknown) => {
		if (typeof v !== "string") return;
		const trimmed = v.trim();
		if (!trimmed) return; // 空文字は上書きしない
		out[key] = trimmed;
	};

	const putOptionalText = (key: keyof SeoData, v: unknown) => {
		if (v == null) return; // null/undefined は上書きしない
		putText(key, v);
	};

	putOptionalText("title", data.title);
	putOptionalText("description", data.description);
	putOptionalText("image", data.image);
	putOptionalText("imageAlt", data.imageAlt);
	putOptionalText("robots", data.robots);
	putOptionalText("siteName", data.siteName);

	return out;
}

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
		const normalized = normalizeOverride(seoOverride.data);

		setStack((prev) => {
			const filtered = prev.filter((item) => item.id !== seoOverride.id);
			return [...filtered, { ...seoOverride, data: normalized }];
		});
	}, []);

	// #717 【設計】unmount/blur時にスタックから削除して上書きを解除
	const pop = useCallback((id: string) => {
		setStack((prev) => prev.filter((item) => item.id !== id));
	}, []);

	// #717 【設計】defaults + stackTopをマージして現在のSEO値を算出
	const stackTop = stack.length > 0 ? stack[stack.length - 1].data : undefined;
	const current: SeoData = {
		...defaults,
		...(stackTop ? Object.fromEntries(Object.entries(stackTop).filter(([, v]) => v !== undefined)) : {}),
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
