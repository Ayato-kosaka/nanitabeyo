/*
#1375 実機確認 / #1629: 全画面 Feed の «縦 = ページ送り» を支える並びの決め方を固定する。

## 何を守っているか

- **並びは絞り込みではない**: 店舗の並びは Map の viewport 由来なので、
  `useMyDishesFilterStore`（＝ユーザーが選んだ絞り込み）へ混ぜない。混ぜると queryKey が
  pan/zoom のたびに変わり、約 964MB の `dish_reviews` へクエリが飛び続ける（設計 §3-2 / §7-1）
- **全件をページにしない**: ピンが 200 件あるエリアで 200 ページを作らない。前後 1 件ずつで
  «横に続きがある» ことは伝わる
- **知らないときは 1 ページへ縮退する**: web の直リンク・リロードでは並びが無い
*/
import { sliceScopeWindow, useMyDishesFeedScopeStore } from "@/features/myDishes/stores/useMyDishesFeedScopeStore";

describe("sliceScopeWindow", () => {
	const IDS = ["a", "b", "c", "d", "e"];

	it("前後 1 件ずつ、計 3 件だけを切り出す", () => {
		expect(sliceScopeWindow(IDS, "c")).toEqual(["b", "c", "d"]);
	});

	it("先頭・末尾では詰めずに端で止める（存在しない隣を作らない）", () => {
		expect(sliceScopeWindow(IDS, "a")).toEqual(["a", "b"]);
		expect(sliceScopeWindow(IDS, "e")).toEqual(["d", "e"]);
	});

	it("並びに含まれない id は 1 ページへ縮退する", () => {
		expect(sliceScopeWindow(IDS, "zzz")).toEqual(["zzz"]);
	});

	it("並びが空なら 1 ページへ縮退する（直リンク・リロード）", () => {
		expect(sliceScopeWindow([], "a")).toEqual(["a"]);
	});
});

describe("useMyDishesFeedScopeStore", () => {
	afterEach(() => {
		useMyDishesFeedScopeStore.getState().clear();
	});

	it("既定は空（＝並びを知らない）", () => {
		expect(useMyDishesFeedScopeStore.getState().restaurantIds).toEqual([]);
	});

	it("置いた並びをそのまま返し、clear で空へ戻る", () => {
		useMyDishesFeedScopeStore.getState().setRestaurantIds(["a", "b"]);
		expect(useMyDishesFeedScopeStore.getState().restaurantIds).toEqual(["a", "b"]);

		useMyDishesFeedScopeStore.getState().clear();
		expect(useMyDishesFeedScopeStore.getState().restaurantIds).toEqual([]);
	});

	/*
	#1629 一覧（グリッド）の並びは **行そのまま**（店舗 id ではない）。
	重複排除しないので、同じ店の記録が 3 件並んでいたら縦のページも 3 枚になる。
	*/
	it("一覧の行の並びを、重複を潰さずそのまま持ち、clear で空へ戻る", () => {
		const rows = [
			{ itemKey: "review:a", dishMediaId: "media-a" },
			// 同じ店の 2 件目でも別のページ。key は itemKey なので衝突しない
			{ itemKey: "review:b", dishMediaId: "media-b" },
		];
		useMyDishesFeedScopeStore.getState().setListItems(rows);
		expect(useMyDishesFeedScopeStore.getState().listItems).toEqual(rows);

		useMyDishesFeedScopeStore.getState().clear();
		expect(useMyDishesFeedScopeStore.getState().listItems).toEqual([]);
	});

	// ⚠️ 永続化してはいけない。再起動後に前回の viewport 由来の並びが横スクロールへ出るのは事故
	it("persist（AsyncStorage）を使っていない", () => {
		const store = useMyDishesFeedScopeStore as unknown as { persist?: unknown };
		expect(store.persist).toBeUndefined();
	});
});
