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
	selectCalendarQueryKey,
	selectFilterQueryKey,
	selectRestaurantQueryKey,
	toMyDishesCalendarQueryParams,
	toMyDishesDateQueryParams,
	toMyDishesQueryParams,
	toMyDishesRestaurantQueryParams,
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
			["area", "categoryIds", "featureKeys", "from", "minRating", "ratings", "sort", "status", "to"].sort(),
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
			featureKeys: [],
			minRating: null,
			ratings: [],
			from: null,
			to: null,
			area: null,
			sort: "-occurredAt",
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
	// #1375 実機確認: 軸は複数重ねられる（sort は -featureScore 1 つ）
	it("featureKeys は sort が -featureScore のときだけ送る（絞り込みには使わない）", () => {
		getState().patch({ sort: "-featureScore", featureKeys: ["timeSlot:dinner", "scene:date"] });
		const params = toMyDishesQueryParams(getState().filter);
		expect(params.sort).toBe("-featureScore");
		// 選んだ順に依存しないよう、常にソートしてから積む
		expect(params.featureKeys).toEqual(["scene:date", "timeSlot:dinner"]);

		getState().patch({ sort: "-occurredAt" });
		expect(toMyDishesQueryParams(getState().filter).featureKeys).toBeUndefined();
	});

	it("軸未選択の -featureScore は既定の並びへ落とす", () => {
		getState().patch({ sort: "-featureScore", featureKeys: [] });
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

/*
#1397 §8-1 / Q5: 料理メディア Sheet 用の派生クエリ（`toMyDishesRestaurantQueryParams` /
`selectRestaurantQueryKey`）。

⚠️ `restaurantId` は共有フィルタ（`MyDishesFilter`）には絶対に入れない。上の
「filter のフィールドは «ユーザーが選んだもの» だけ」テストがそれを固定しているので、
ここでは派生クエリ側（filter の外）だけを見る。
*/
describe("#1397 Sheet 用派生クエリ（toMyDishesRestaurantQueryParams / selectRestaurantQueryKey）", () => {
	const RESTAURANT_ID = "22222222-2222-2222-2222-000000000002";

	it("restaurantId を含み、sort / featureKeys を持たない", () => {
		getState().patch({ sort: "-featureScore", featureKeys: ["scene:date", "timeSlot:dinner"] });

		const params = toMyDishesRestaurantQueryParams(getState().filter, RESTAURANT_ID) as Record<string, unknown>;
		expect(params.restaurantId).toBe(RESTAURANT_ID);
		expect(params.sort).toBeUndefined();
		expect(params.featureKeys).toBeUndefined();
	});

	it("sort 以外のフィルタ（status / minRating 等）は base と同じものを引き継ぐ", () => {
		getState().patch({ status: ["eaten"], minRating: 4 });

		const params = toMyDishesRestaurantQueryParams(getState().filter, RESTAURANT_ID);
		expect(params.status).toEqual(["eaten"]);
		expect(params.minRating).toBe(4);
	});

	it("派生 queryKey は base の queryKey とは別のキーになる", () => {
		getState().patch({ status: ["eaten"], minRating: 4 });

		const baseKey = queryKey();
		const restaurantKey = selectRestaurantQueryKey(RESTAURANT_ID)(getState());
		expect(restaurantKey).not.toBe(baseKey);
		expect(restaurantKey).toContain(`restaurantId=${RESTAURANT_ID}`);
	});

	it("distance / -sceneScore / -timeSlotScore を選んでいても、派生 queryKey には出てこない（Q5）", () => {
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		getState().patch({ sort: "distance" });

		const restaurantKey = selectRestaurantQueryKey(RESTAURANT_ID)(getState());
		expect(restaurantKey).not.toMatch(/sort=/);
		// area（lat/lng/radius）は絞り込みそのものなので、派生クエリでも引き継がれる
		expect(restaurantKey).toContain("lat=35.68");
	});

	it("restaurantId が違えば別の queryKey になる（店舗ごとに別スライスへ落ちる）", () => {
		const a = selectRestaurantQueryKey(RESTAURANT_ID)(getState());
		const b = selectRestaurantQueryKey("33333333-3333-3333-3333-000000000003")(getState());
		expect(a).not.toBe(b);
	});
});

/*
#1446 M-2: Calendar 用の派生クエリ（`toMyDishesCalendarQueryParams` / `selectCalendarQueryKey`）。

Calendar は「上へスクロールして過去へ遡る」UI なので、ページが日付の降順で届くことを前提にしている。
`sort` が `-rating` / `distance` / `-sceneScore` / `-timeSlotScore` だと空の月が数十個並び、
上へ遡っても何も増えない。`sort: "occurredAt"` に至っては向きそのものが逆になる。

⚠️ `MyDishesFilter` のキー集合は増やさない（上の「filter のフィールドは «ユーザーが選んだもの» だけ」
テストが固定している）。派生値は filter の外で作る。#1397 PR2 と同じ作法である。
*/
describe("#1446 Calendar 用派生クエリ（toMyDishesCalendarQueryParams / selectCalendarQueryKey）", () => {
	// ★ ここが本命。共有 sort が既定なら派生キーは base と «完全に一致» するので、
	//   常用ケースでは追加の取得も LRU の追加消費も一切起きない
	it("共有 sort が既定（-occurredAt）なら、派生 queryKey は base の queryKey と完全に一致する", () => {
		expect(selectCalendarQueryKey(getState())).toBe(queryKey());

		// フィルタが載っていても一致する（落とすのは並び順だけ）
		getState().patch({ status: ["eaten"], minRating: 4, categoryIds: ["c2", "c1"] });
		expect(selectCalendarQueryKey(getState())).toBe(queryKey());

		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		expect(selectCalendarQueryKey(getState())).toBe(queryKey());
	});

	it("sort / featureKeys を持たない", () => {
		getState().patch({ sort: "-featureScore", featureKeys: ["scene:date", "timeSlot:dinner"] });

		const params = toMyDishesCalendarQueryParams(getState().filter) as Record<string, unknown>;
		expect(params.sort).toBeUndefined();
		expect(params.featureKeys).toBeUndefined();
	});

	it("sort 以外のフィルタ（status / minRating / area / 期間）は base と同じものを引き継ぐ", () => {
		getState().patch({ status: ["eaten"], minRating: 4, from: "2026-08-10T00:00:00.000Z" });
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		getState().patch({ sort: "distance" });

		const params = toMyDishesCalendarQueryParams(getState().filter);
		expect(params.status).toEqual(["eaten"]);
		expect(params.minRating).toBe(4);
		expect(params.from).toBe("2026-08-10T00:00:00.000Z");
		// area（lat/lng/radius）は絞り込みそのものなので引き継ぐ。落とすのは sort だけ
		expect(params.lat).toBe(35.68);
	});

	it("共有 sort が日付順以外のときだけ base と別キーになる（そのときも sort は出てこない）", () => {
		getState().patch({ sort: "-rating", status: ["eaten"] });

		const calendarKey = selectCalendarQueryKey(getState());
		expect(calendarKey).not.toBe(queryKey());
		expect(calendarKey).not.toMatch(/sort=/);
		expect(queryKey()).toMatch(/sort=-rating/);
	});

	it("sort だけが違う 2 つの filter は、Calendar から見ると同じキーになる（無駄な取り直しをしない）", () => {
		getState().patch({ sort: "-rating" });
		const a = selectCalendarQueryKey(getState());
		getState().patch({ sort: "occurredAt" });
		const b = selectCalendarQueryKey(getState());
		expect(a).toBe(b);
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

/*
#1629【提案 2】Calendar の日付タップから開く Feed 用の派生クエリ（`toMyDishesDateQueryParams`）。

オーナー確定「フィルタの条件はマップ・グリッド・カレンダーで一緒、出力結果も同じにする」。

以前はここでエリア（`lat` / `lng` / `radius`）を落としていた。その結果 **月グリッドのマス目は
エリアで絞られているのに、そのマスを開いた Feed だけ全件**という食い違いが出ていた
（マスが空なのに開くと記録が入っている）。落とすのは並び替え（`sort` / `featureKeys`）だけである。
*/
describe("#1629 日付フィード用派生クエリ（toMyDishesDateQueryParams）", () => {
	const DATE = "2026-08-20";

	// ★ ここが本命。エリアを «落とさない» ことがオーナー確定の要件そのもの
	it("エリア（lat / lng / radius）を引き継ぐ", () => {
		getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });

		const params = toMyDishesDateQueryParams(getState().filter, DATE);
		expect(params.lat).toBe(35.68);
		expect(params.lng).toBe(139.76);
		expect(params.radius).toBe(1200);
	});

	it("落とすのは sort / featureKeys だけ。他の絞り込みは base と同じものを引き継ぐ", () => {
		getState().patch({
			status: ["eaten"],
			minRating: 4,
			categoryIds: ["c1"],
			sort: "-featureScore",
			featureKeys: ["scene:date"],
		});

		const params = toMyDishesDateQueryParams(getState().filter, DATE) as Record<string, unknown>;
		expect(params.sort).toBeUndefined();
		expect(params.featureKeys).toBeUndefined();
		expect(params.status).toEqual(["eaten"]);
		expect(params.minRating).toBe(4);
		expect(params.categoryIds).toEqual(["c1"]);
	});

	it("期間はその日 1 日へ差し替える（共有フィルタの from / to は上書きされる）", () => {
		getState().patch({ from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" });

		const params = toMyDishesDateQueryParams(getState().filter, DATE);
		// 境界は端末のローカル日付で切る（カレンダーのマス目がローカル日付で並んでいるため）
		expect(new Date(params.from as string).getFullYear()).toBe(2026);
		expect(new Date(params.from as string).getDate()).toBe(20);
		expect(new Date(params.to as string).getDate()).toBe(20);
	});
});
