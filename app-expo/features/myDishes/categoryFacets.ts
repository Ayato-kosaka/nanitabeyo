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
	/*
	#1629 表示名は **カテゴリごとに 1 つ**（`dish_categories.labels` 由来）になった。
	以前は行ごとの `dishes.name` を数えて «最頻の呼び名» をラベルにしていたが、
	`dishes.name` は表示に使わなくなったので、その多数決はもう意味を持たない
	（同じカテゴリなら必ず同じ文字列が返る）。最初に引けた表記をそのまま使う。
	*/
	const byCategory = new Map<string, { count: number; label: string | null }>();
	for (const item of items) {
		const categoryId = item.dish?.category_id;
		if (!categoryId) continue;
		let entry = byCategory.get(categoryId);
		if (!entry) {
			entry = { count: 0, label: resolveDishCategoryLabel(item.dish?.categoryLabels, locale) };
			byCategory.set(categoryId, entry);
		}
		entry.count += 1;
	}

	const facets: MyDishCategoryFacet[] = [];
	for (const [categoryId, entry] of byCategory) {
		// 表記が引けないカテゴリは出さない（QID を見せない）
		if (entry.label === null) continue;
		facets.push({ categoryId, label: entry.label, count: entry.count });
	}

	// 件数の多い順。同数はラベルの辞書順で安定させる（毎回並びが揺れるとテストtoo/UI が落ち着かない）
	facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	return facets.slice(0, limit);
};
