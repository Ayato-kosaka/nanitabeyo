import type { MyDishStatus } from "@shared/api/v1/dto";

import { FixedColors } from "@/constants/Palette";

/**
 * #1375 my-dishes 全体で «食べたい / 食べた» を表す記号色。
 *
 * ## 塗りで区別する（色相では区別しない）— 5 巡目のオーナー指示
 *
 * | 状態 | 見た目 |
 * | --- | --- |
 * | want（食べたい） | **白塗り + オレンジ枠**（まだ埋まっていない = これから） |
 * | eaten（食べた） | **オレンジ塗り**（埋まった = 済んだ） |
 *
 * 2 巡目〜5 巡目の途中までは «緑 = 食べたい / 赤 = 食べた» の色相分けだった。
 * オーナー指示で塗りの有無へ変えている。塗りの差は色覚に依存せず、
 * サムネイルの上でも «埋まっているか» が形として読める。
 *
 * ## 色相（7 巡目・オーナー指示でオレンジへ）

ブランドの赤（`#F05537`）は **CTA（＋ボタン・投稿ボタン）の色**である。同じ色を状態の
記号にも使っていたため、«押すもの» と «状態を表すだけのもの» が同じ強さで並んでいた。
オーナー指示でオレンジへ分けた。

⚠️ **`#ED6C02` は白文字とのコントラスト比 3.11:1** で、太字の数字・アイコン（UI 部品）の
下限 3:1 を満たす。**これより明るいオレンジ（`#F97316` = 2.8、`#FB8C00` = 2.37）へ
動かさないこと。** 上に載る白文字が読めなくなる。

⚠️ これは **状態を区別するための記号色**であって、「この色を CTA 以外へ広げてよい」という
意味ではない（`docs/design-guidelines.md` §1）。新しい画面へ足したくなったら、
まず状態の記号かどうかを確かめること。
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

/**
 * 状態の記号に使うオレンジ。記号としてはこの 1 色だけを使う。
 *
 * ⚠️ 明るくしない（白文字が読めなくなる。上のコントラストの注記を参照）。
 */
export const MY_DISH_STATUS_ORANGE = FixedColors.myDishStatusOrange;

export const MY_DISH_STATUS_COLORS: Record<MyDishStatus, MyDishStatusPaint> = {
	want: { fill: FixedColors.myDishStatusOn, border: MY_DISH_STATUS_ORANGE, on: MY_DISH_STATUS_ORANGE },
	eaten: { fill: MY_DISH_STATUS_ORANGE, border: FixedColors.myDishStatusOn, on: FixedColors.myDishStatusOn },
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
