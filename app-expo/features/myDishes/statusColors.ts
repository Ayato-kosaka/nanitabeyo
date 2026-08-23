import type { MyDishStatus } from "@shared/api/v1/dto";

/**
 * #1375 my-dishes 全体で «食べたい / 食べた» を表す記号色。
 *
 * ## 塗りで区別する（色相では区別しない）— 5 巡目のオーナー指示
 *
 * | 状態 | 見た目 |
 * | --- | --- |
 * | want（食べたい） | **白塗り + 赤枠**（まだ埋まっていない = これから） |
 * | eaten（食べた） | **赤塗り**（埋まった = 済んだ） |
 *
 * 2 巡目〜5 巡目の途中までは «緑 = 食べたい / 赤 = 食べた» の色相分けだった。
 * オーナー指示で塗りの有無へ変えている。塗りの差は色覚に依存せず、
 * サムネイルの上でも «埋まっているか» が形として読める。
 *
 * ⚠️ これは **状態を区別するための記号色**であって、「赤を CTA 以外へ広げてよい」という
 * 意味ではない（`docs/design-guidelines.md` §1）。新しい画面へ赤を足したくなったら、
 * まず状態の記号かどうかを確かめること。
 *
 * ## 3 つ組で持つ理由
 *
 * 白塗りの側は **文字も枠も赤**でなければ読めない。塗りの色だけを配ると
 * 「白地に白文字」を作れてしまうので、`fill` / `border` / `on`（上に載る文字・アイコン）を
 * 必ず 1 組で配る。
 */
export type MyDishStatusPaint = {
	/** 地の色 */
	fill: string;
	/** 縁の色。写真の上に載っても輪郭が保たれる値にしてある */
	border: string;
	/** 上に載る文字・アイコンの色 */
	on: string;
};

/** ブランドの赤（`docs/design-guidelines.md` のパレット）。記号としてはこの 1 色だけを使う */
const BRAND_RED = "#F05537";

export const MY_DISH_STATUS_COLORS: Record<MyDishStatus, MyDishStatusPaint> = {
	want: { fill: "#FFFFFF", border: BRAND_RED, on: BRAND_RED },
	eaten: { fill: BRAND_RED, border: "#FFFFFF", on: "#FFFFFF" },
};

/** 件数の内訳。`countMyDishStatuses` の返り値 */
export type MyDishStatusCounts = { want: number; eaten: number };

/** 記録の配列を「食べたい / 食べた」の件数へ畳む（カレンダーの日バッジ・地図の帯カードが使う） */
export const countMyDishStatuses = (items: readonly { status: MyDishStatus }[]): MyDishStatusCounts => {
	let want = 0;
	let eaten = 0;
	for (const item of items) {
		if (item.status === "eaten") eaten += 1;
		else want += 1;
	}
	return { want, eaten };
};
