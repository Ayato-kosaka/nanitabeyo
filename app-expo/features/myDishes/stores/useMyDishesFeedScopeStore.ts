/*
このファイルの責務
- 全画面 Feed の «横スクロールで行き来できるスコープの並び» を、遷移直前に置くための小さな store。

## なぜ store なのか（URL でも filter store でもない）

- **URL に配列を積まない。** 記録が多いエリアでは店舗 id の配列だけで URL が数 KB になる
  （#1397 の «URL に ids を積まない» と同じ理由）。
- **`useMyDishesFilterStore` に入れない。** あちらは «ユーザーが明示的に選んだ絞り込み» だけを
  持つ場所で、viewport 由来の並びを混ぜると `queryKey` が pan/zoom のたびに変わり、
  約 964MB の `dish_reviews` へのクエリが飛び続ける（設計 (2/2) §3-2 / §7-1）。

つまりこの並びは「絞り込み」ではなく「いまこの瞬間の画面の並び」であり、
**その 1 回の遷移のあいだだけ持てばよい**。だから専用の器を分けてある。

## 永続化しない

`AsyncStorage` へ persist しない。再起動して Feed を直リンクで開いたときに、前回の
viewport 由来の並びが横スクロールに出てくるのは事故である。store が空のときは
Feed 側が «1 ページだけ» へ縮退する。

## 日付スコープはここを使わない

前後の日は計算で決まる（`my-dishes/feed.tsx` の `shiftDate`）。計算で出せるものを
store 経由にすると、直リンクとアプリ内遷移で挙動が変わる。
*/
import { createWithEqualityFn } from "zustand/traditional";

export type MyDishesFeedScopeStore = {
	/** 順序付きの店舗 id。空なら «並びは分からない»（Feed は 1 ページへ縮退する） */
	restaurantIds: string[];
	/** 遷移直前に置く。呼ぶのは Map / 一覧のように «並びを知っている» 側だけ */
	setRestaurantIds: (restaurantIds: string[]) => void;
	clear: () => void;
};

export const useMyDishesFeedScopeStore = createWithEqualityFn<MyDishesFeedScopeStore>()((set) => ({
	restaurantIds: [],
	setRestaurantIds: (restaurantIds) => set({ restaurantIds }),
	clear: () => set({ restaurantIds: [] }),
}));

/**
 * `current` を含む前後 `radius` 件だけを切り出す。
 *
 * 全件を横スクロールの対象にしない。ピンが 200 件あるエリアで 200 ページを作ると、
 * `getItemLayout` の計算だけは軽くても «隣に来るかもしれない» ページの数が増えて
 * 取得の抑制（`isActive`）に頼り切りになる。前後 1 件ずつあれば «横に続きがある» ことは伝わる。
 */
export const sliceScopeWindow = (ids: string[], current: string, radius = 1): string[] => {
	const index = ids.indexOf(current);
	if (index < 0) return [current];
	const start = Math.max(0, index - radius);
	const end = Math.min(ids.length, index + radius + 1);
	return ids.slice(start, end);
};
