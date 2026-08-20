/*
#1396 共有フィルタ store の不変条件を固定する。

## 最重要: **Map の viewport（`Region`）を filter store に入れないこと**（設計書 (2/2) §3-2 / §8-4 リスク2）

pan / zoom は毎フレーム発火する。それを store に流すと `queryKey` が変わり続け、
裏にいるリストと Calendar が**再取得され続ける**。相手は約 964MB の `dish_reviews`
（#1395 §0(A) の実測: 平均 4.48 秒 / 最大 11.23 秒）である。

このファイルはそれを **2 段構え**で守る。

1. `filter` と store のトップレベルの**キー集合そのものを固定する**。
   `region` / `viewport` / `latitudeDelta` の類を 1 つでも足すと赤くなる。
   「viewport っぽい名前」を禁止語で弾くだけだと、`mapCenter` のような別名で抜けられる。
2. `queryKey` が**エリアを `commitArea` したときにだけ変わる**ことを見る。
   仮に誰かが viewport を混ぜても、`queryKey` の安定性テストが先に落ちる。

`useMyDishesStore`（取得結果側）の LRU は `myDishesStore.test.ts` が受け持つ。
*/
import {
	DEFAULT_MY_DISHES_FILTER,
	isRatingFilterEnabled,
	resolveSort,
	selectFilterQueryKey,
	toMyDishesQueryParams,
	useMyDishesFilterStore,
	type MyDishesFilter,
} from "../features/myDishes/stores/useMyDishesFilterStore";

const getState = () => useMyDishesFilterStore.getState();
const queryKey = () => selectFilterQueryKey(getState());

beforeEach(() => {
	getState().reset();
});

describe("#1396 useMyDishesFilterStore が持つもの / 持たないもの", () => {
	it("filter のフィールドは «ユーザーが選んだもの» だけ（viewport は 1 つも無い）", () => {
		// ⚠️ このリストを増やすときは、それが «ユーザーが明示的に選んだもの» か必ず確認すること。
		// Map の region / viewport / delta をここへ足すと、pan のたびに 964MB のテーブルへクエリが飛ぶ。
		expect(Object.keys(getState().filter).sort()).toEqual(
			[
				"area",
				"categoryIds",
				"from",
				"minRating",
				"ratings",
				"sceneKey",
				"sort",
				"status",
				"timeSlotKey",
				"to",
			].sort(),
		);
	});

	it("store のトップレベルは filter と 4 つの操作だけ（生の region を置く場所が無い）", () => {
		expect(Object.keys(getState()).sort()).toEqual(["clearArea", "commitArea", "filter", "patch", "reset"].sort());
	});

	it("エリアは lat / lng / radius（+ 任意の label）だけを持ち、delta を持たない", () => {
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		expect(Object.keys(getState().filter.area ?? {}).sort()).toEqual(["lat", "lng", "radius"]);
	});

	it("既定値は «絞り込み無し・新しい順»（再起動時に★の絞り込みが残らない = persist しない）", () => {
		expect(getState().filter).toEqual({
			status: [],
			categoryIds: [],
			minRating: null,
			ratings: [],
			from: null,
			to: null,
			area: null,
			sort: "-occurredAt",
			sceneKey: null,
			timeSlotKey: null,
		});
	});
});

describe("#1396 queryKey が変わる条件", () => {
	it("フィルタを変えなければ何度読んでも同じ（ビュー切替では再取得しない）", () => {
		const before = queryKey();
		expect(queryKey()).toBe(before);
		expect(before).toBe("default");
	});

	it("commitArea で変わる（= 「このエリアで再検索」だけが再取得を起こす）", () => {
		const before = queryKey();
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		expect(queryKey()).not.toBe(before);
	});

	it("status の並び順が違っても同じキーになる（無意味な再取得を作らない）", () => {
		getState().patch({ status: ["want", "eaten"] });
		const a = queryKey();
		getState().patch({ status: ["eaten", "want"] });
		expect(queryKey()).toBe(a);
	});

	it("キーはフィールド名の辞書順で安定する（patch の順序でキーが変わらない）", () => {
		getState().patch({ status: ["eaten"], minRating: 4 });
		const a = queryKey();
		getState().reset();
		getState().patch({ minRating: 4 });
		getState().patch({ status: ["eaten"] });
		expect(queryKey()).toBe(a);
	});
});

describe("#1395 m-4 status に want を含む間は評価フィルタを不活性にする", () => {
	it("status が [] （= 両方）のとき評価フィルタは無効", () => {
		expect(isRatingFilterEnabled(getState().filter)).toBe(false);
	});

	it("status が ['eaten'] のときだけ評価フィルタが有効になる", () => {
		getState().patch({ status: ["eaten"] });
		expect(isRatingFilterEnabled(getState().filter)).toBe(true);
		getState().patch({ status: ["eaten", "want"] });
		expect(isRatingFilterEnabled(getState().filter)).toBe(false);
	});

	it("want を含む間は minRating / ratings を API へ送らない（食べたいが全消しにならない）", () => {
		getState().patch({ status: ["want"], minRating: 4, ratings: [5] });
		const params = toMyDishesQueryParams(getState().filter);
		expect(params.minRating).toBeUndefined();
		expect(params.ratings).toBeUndefined();
	});

	it("不活性な評価を触っても queryKey は変わらない（無駄な再取得を作らない）", () => {
		getState().patch({ status: ["want"] });
		const before = queryKey();
		getState().patch({ minRating: 4 });
		expect(queryKey()).toBe(before);
	});

	it("status を ['eaten'] に絞れば評価が API へ乗る", () => {
		getState().patch({ status: ["eaten"], minRating: 4, ratings: [5, 4] });
		const params = toMyDishesQueryParams(getState().filter);
		expect(params.minRating).toBe(4);
		expect(params.ratings).toEqual([4, 5]);
	});
});

describe("#1395 §4-3 sort の同伴パラメータが欠けたクエリを組まない", () => {
	it("エリア未確定の distance は既定の -occurredAt へ落とす（400 を作らない）", () => {
		getState().patch({ sort: "distance" });
		expect(resolveSort(getState().filter)).toBe("-occurredAt");
		expect(toMyDishesQueryParams(getState().filter).sort).toBeUndefined();
	});

	it("エリアを確定すれば distance を送り、lat / lng / radius が揃う", () => {
		getState().patch({ sort: "distance" });
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		const params = toMyDishesQueryParams(getState().filter);
		expect(params.sort).toBe("distance");
		expect(params).toMatchObject({ lat: 35.68, lng: 139.76, radius: 1200 });
	});

	it("clearArea は distance ソートも既定へ戻す（エリアだけ消えて 400 になるのを防ぐ）", () => {
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		getState().patch({ sort: "distance" });
		getState().clearArea();
		expect(getState().filter.area).toBeNull();
		expect(getState().filter.sort).toBe("-occurredAt");
	});

	// #1396 確定B: 時間帯・シチュエーションは「絞り込み」ではなく「並び替え」として出す
	it("sceneKey / timeSlotKey は sort に対応するときだけ送る（絞り込みには使わない）", () => {
		getState().patch({ sort: "-sceneScore", sceneKey: "date", timeSlotKey: "dinner" });
		const scene = toMyDishesQueryParams(getState().filter);
		expect(scene.sort).toBe("-sceneScore");
		expect(scene.sceneKey).toBe("date");
		expect(scene.timeSlotKey).toBeUndefined();

		getState().patch({ sort: "-timeSlotScore" });
		const timeSlot = toMyDishesQueryParams(getState().filter);
		expect(timeSlot.sort).toBe("-timeSlotScore");
		expect(timeSlot.timeSlotKey).toBe("dinner");
		expect(timeSlot.sceneKey).toBeUndefined();
	});

	it("キー未選択の -sceneScore / -timeSlotScore は既定の並びへ落とす", () => {
		getState().patch({ sort: "-sceneScore" });
		expect(resolveSort(getState().filter)).toBe("-occurredAt");
		getState().patch({ sort: "-timeSlotScore" });
		expect(resolveSort(getState().filter)).toBe("-occurredAt");
	});
});

describe("#1396 patch / reset", () => {
	it("patch は部分更新（呼び出し側で spread しなくても他のフィールドが消えない）", () => {
		getState().patch({ status: ["eaten"] });
		getState().patch({ from: "2026-08-01T00:00:00.000Z" });
		expect(getState().filter.status).toEqual(["eaten"]);
		expect(getState().filter.from).toBe("2026-08-01T00:00:00.000Z");
	});

	it("reset は既定値へ戻す", () => {
		getState().patch({ status: ["eaten"], minRating: 5 });
		getState().commitArea({ lat: 1, lng: 2, radius: 100 });
		getState().reset();
		expect(getState().filter).toEqual(DEFAULT_MY_DISHES_FILTER);
	});

	it("cursor / limit / view は filter に無い（クエリ層が組み立てる。§3-1）", () => {
		const params = toMyDishesQueryParams(getState().filter) as Record<string, unknown>;
		expect(params.cursor).toBeUndefined();
		expect(params.limit).toBeUndefined();
		expect((getState().filter as Partial<Record<string, unknown>>).view).toBeUndefined();
	});
});

/**
 * 型でも viewport を弾く。`MyDishesFilter` に `region` などが生えたらコンパイルが通らない。
 * （実行時のキー集合検査と 2 つで 1 組。値を持たない型だけの検査なので実行コストは無い）
 */
type ForbiddenViewportKeys = Extract<
	keyof MyDishesFilter,
	"region" | "viewport" | "latitudeDelta" | "longitudeDelta" | "mapCenter" | "camera"
>;
const _assertNoViewportInFilter: ForbiddenViewportKeys extends never ? true : never = true;
void _assertNoViewportInFilter;
