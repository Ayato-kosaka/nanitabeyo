/*
このファイルの責務
- 絞り込み画面の「料理カテゴリー」候補を、**いま画面に出ている記録**から数えて作る（#1375 3 巡目）。

## なぜサーバに聞かないのか

要件が「出てきてるものの中で料理カテゴリーが多いものを絞り込ませる」なので、
数える母集団は «取得済みの一覧そのもの» が正しい。サーバへ facet 集計を足すと
約 964MB の dish_reviews へ集計クエリがもう 1 本増えるうえ、一覧とタイミングが
ズレた数字が出る。読み込み済みページの範囲で数えれば十分である。

## ラベルの決め方

`dish.name`（その店でのそのカテゴリの呼び名）のうち最頻のものを使う。
名前が 1 件も無いカテゴリ（SNS 取り込みだけのカテゴリ等）は **候補に出さない** —
Wikidata QID をそのままユーザーに見せない、というフィードチップと同じ規則
（`MyDishesFeedChips.tsx`）。
*/
import type { MyDishItem } from "@shared/api/v1/res";
import { resolveDishCategoryLabel } from "./dishCategoryLabel";

export type MyDishCategoryFacet = {
	categoryId: string;
	label: string;
	count: number;
};

export const buildCategoryFacets = (
	items: readonly MyDishItem[],
	limit = 8,
	/*
	#1375（オーナー実機指摘「うどんで絞ったら udon が出る」）
	表示名は **カテゴリの正式表記を優先**する。`dish.name` は «その店でのその料理の呼び名» で、
	SNS 取り込み由来だとローマ字が入る。解決規則は `dishCategoryLabel.ts` にある。
	既定は日本語（呼び出し側が必ず渡すが、引数を増やして既存の呼び出しを壊さないため）。
	*/
	locale = "ja-JP",
): MyDishCategoryFacet[] => {
	const byCategory = new Map<string, { count: number; labelCounts: Map<string, number> }>();
	for (const item of items) {
		const categoryId = item.dish?.category_id;
		if (!categoryId) continue;
		let entry = byCategory.get(categoryId);
		if (!entry) {
			entry = { count: 0, labelCounts: new Map() };
			byCategory.set(categoryId, entry);
		}
		entry.count += 1;
		const name = resolveDishCategoryLabel(item.dish?.categoryLabels, item.dish?.name, locale);
		if (name) entry.labelCounts.set(name, (entry.labelCounts.get(name) ?? 0) + 1);
	}

	const facets: MyDishCategoryFacet[] = [];
	for (const [categoryId, entry] of byCategory) {
		let label: string | null = null;
		let best = 0;
		for (const [name, count] of entry.labelCounts) {
			if (count > best) {
				best = count;
				label = name;
			}
		}
		// 名前が引けないカテゴリは出さない（QID を見せない）
		if (label === null) continue;
		facets.push({ categoryId, label, count: entry.count });
	}

	// 件数の多い順。同数はラベルの辞書順で安定させる（毎回並びが揺れるとテストtoo/UI が落ち着かない）
	facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	return facets.slice(0, limit);
};
