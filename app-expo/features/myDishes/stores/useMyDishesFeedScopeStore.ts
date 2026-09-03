/*
このファイルの責務
- 全画面 Feed の «縦フリックで行き来できるページの並び» を、遷移直前に置くための小さな store。
  入口ごとに «1 ページが何か» が違う（#1629）。

| 入口 | 縦の 1 ページ | 置く場所 |
| --- | --- | --- |
| 一覧（グリッド） | **グリッドのセル 1 つ** | `listItems` |
| Map（ピン） | 店舗 1 つ | `restaurantIds` |
| Calendar（日付） | 記録がある日 1 つ | `dateKeys` |

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
 * #1629 【設計】**一覧（グリッド）の 1 行 = フィードの 1 ページ。**
 *
 * グリッドの縦送りは «店舗» でも «日» でもなく、**グリッドに出ている順のセルそのもの**である
 * （オーナー指摘「お店でグルーピングしてるなら要らない。グリッドは上下だけ」）。
 * だから店舗 id ではなく «行» をそのまま並べる。重複排除はしない。同じ店の記録が
 * 3 件並んでいるなら、縦のページも 3 枚である。
 *
 * `dishMediaId` を一緒に持つのは、フィード側が **行の取得を 1 回も挟まずに**
 * `GET /v1/dish-media?ids=` だけでそのページを描けるようにするため。
 * `itemKey` は一覧の行を一意に指すので、ページャの key にそのまま使える
 * （店舗 id を key にすると、同じ店が 2 行あるだけで衝突する）。
 *
 * #1761 **`dishMediaId` は null を取る。** 写真の無い記録（投稿を消した記録を含む）も
 * グリッドの 1 セル ＝ フィードの 1 ページである。以前はそれだけボトムシートで開いていたが、
 * Calendar / Map が #1752 でフィードに寄ったので、入口ごとの例外をなくした。
 *
 * `restaurantId` は **web の直リンク・リロードのためだけ**に持つ。写真の無いページは
 * クチコミ本文（`myReview`）が要り、それは行にしか無い。通常の遷移では
 * `useMyDishesStore.itemByKey` に行が残っているので取得は増えないが、リロード後は空なので
 * «その店舗の記録» を引き直して key で選ぶ（行 1 件を key で引く API は無い）。
 */
export type MyDishesFeedListItem = { itemKey: string; dishMediaId: string | null; restaurantId: string };

export type MyDishesFeedScopeStore = {
	/** 順序付きの店舗 id（Map のピンの並び）。空なら «並びは分からない»（Feed は 1 ページへ縮退する） */
	restaurantIds: string[];
	/** 記録がある日付（YYYY-MM-DD）の昇順。空なら «並びは分からない»（Feed は 1 日へ縮退する） */
	dateKeys: string[];
	/** #1629 一覧に出ている行の並び。空なら «並びは分からない»（Feed は 1 ページへ縮退する） */
	listItems: MyDishesFeedListItem[];
	/** 遷移直前に置く。呼ぶのは Map のように «店舗の並びを知っている» 側だけ */
	setRestaurantIds: (restaurantIds: string[]) => void;
	/** 遷移直前に置く。呼ぶのは Calendar のように «記録がある日を知っている» 側だけ */
	setDateKeys: (dateKeys: string[]) => void;
	/** #1629 遷移直前に置く。呼ぶのは一覧（グリッド）だけ */
	setListItems: (listItems: MyDishesFeedListItem[]) => void;
	clear: () => void;
};

export const useMyDishesFeedScopeStore = createWithEqualityFn<MyDishesFeedScopeStore>()((set) => ({
	restaurantIds: [],
	dateKeys: [],
	listItems: [],
	setRestaurantIds: (restaurantIds) => set({ restaurantIds }),
	setDateKeys: (dateKeys) => set({ dateKeys }),
	setListItems: (listItems) => set({ listItems }),
	clear: () => set({ restaurantIds: [], dateKeys: [], listItems: [] }),
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
