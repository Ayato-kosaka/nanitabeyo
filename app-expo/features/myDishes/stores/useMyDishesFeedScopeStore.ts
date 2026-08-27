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

## 日付スコープ（#1375 実機確認 2 巡目で方針転換）

以前は «前後の日は計算で決まる（±1 日）» としていたが、隣の日に記録が無いと
「見つかりません」の空ページが挟まる、という指摘を受けた。縦フリックで行き来するのは
**記録がある日だけ**にしたいので、Calendar が知っている «記録がある日付の並び» を
店舗 id と同じ作法でここへ置く（昇順 = 古 → 新）。
store が空のとき（web の直リンク・リロード）は Feed 側が 1 日だけへ縮退する。
*/
import { createWithEqualityFn } from "zustand/traditional";

/**
 * #1629 並びの出どころ。**前後を何件まで見せるかがこれで変わる。**
 *
 * - `map` … viewport 由来。ピンが 200 件あるエリアでは 200 ページになりうるので前後 1 件へ絞る
 * - `list` … 一覧に出ている並び。**絞らない**。一覧は «上から順に見ていく» 面なので、
 *   縦にフリックし続けたら一覧の最後まで行けるのが期待される挙動である（オーナー指摘）
 */
export type MyDishesFeedScopeSource = "map" | "list";

export type MyDishesFeedScopeStore = {
	/** 順序付きの店舗 id。空なら «並びは分からない»（Feed は 1 ページへ縮退する） */
	restaurantIds: string[];
	/** #1629 `restaurantIds` を置いたのが誰か。前後を絞るかどうかの判断に使う */
	restaurantIdsSource: MyDishesFeedScopeSource | null;
	/** 記録がある日付（YYYY-MM-DD）の昇順。空なら «並びは分からない»（Feed は 1 日へ縮退する） */
	dateKeys: string[];
	/** 遷移直前に置く。呼ぶのは Map / 一覧のように «並びを知っている» 側だけ */
	setRestaurantIds: (restaurantIds: string[], source: MyDishesFeedScopeSource) => void;
	/** 遷移直前に置く。呼ぶのは Calendar のように «記録がある日を知っている» 側だけ */
	setDateKeys: (dateKeys: string[]) => void;
	clear: () => void;
};

export const useMyDishesFeedScopeStore = createWithEqualityFn<MyDishesFeedScopeStore>()((set) => ({
	restaurantIds: [],
	restaurantIdsSource: null,
	dateKeys: [],
	setRestaurantIds: (restaurantIds, source) => set({ restaurantIds, restaurantIdsSource: source }),
	setDateKeys: (dateKeys) => set({ dateKeys }),
	clear: () => set({ restaurantIds: [], restaurantIdsSource: null, dateKeys: [] }),
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
