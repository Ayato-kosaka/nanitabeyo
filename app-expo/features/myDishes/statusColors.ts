import type { MyDishStatus } from "@shared/api/v1/dto";

/**
 * #1375 実機確認（5 巡目）: 「食べたい = 緑丸 / 食べた = 赤丸」を my-dishes 全体の共通語彙にする。
 *
 * 2 巡目で myDishCard と MyDishesListView のバッジに色を入れたとき、同じ値を 2 ファイルへ
 * 直書きし「必ず一致させること」とコメントで縛っていた。5 巡目でカレンダーの日バッジ・
 * 地図の帯カード・凡例と使う場所が 4 つ増えるので、値の正をここ 1 箇所へ寄せる。
 *
 * ## 色の根拠（`docs/design-guidelines.md` §1 のパレット）
 *
 * - want  … `rgba(22,163,74,0.9)`  「まだ行っていない（Go）」の緑。既存バッジと同値
 * - eaten … `rgba(240,85,55,0.9)`  ブランド `#F05537` の 90%。既存バッジと同値
 *
 * ⚠️ これは **状態を区別するための記号色**であって、「赤を CTA 以外へ広げてよい」という
 * 意味ではない。新しい画面へ赤を足したくなったら、まず状態の記号かどうかを確かめること。
 */
export const MY_DISH_STATUS_COLORS: Record<MyDishStatus, string> = {
	want: "rgba(22,163,74,0.9)",
	eaten: "rgba(240,85,55,0.9)",
};

/** 記号色の上に載る文字。地が濃いので light / dark で振らない（FixedColors.onFilled と同じ判断） */
export const MY_DISH_STATUS_ON_COLOR = "#FFFFFF";

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
