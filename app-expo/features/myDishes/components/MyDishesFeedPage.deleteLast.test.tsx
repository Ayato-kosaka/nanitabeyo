/*
#1629【35/40】オーナー実機報告（3 巡連続）:

> 投稿を削除したら **次の投稿** が無限ローディングになった

## 実ログで確定した筋道（2026-08-29 / BigQuery）

削除の前後、サーバは全部 40〜230 ms で健全だった（プール枯渇でもクエリ遅延でもない）。
決め手は `GET /v1/dish-media?ids=` が **毎回 1 件だけ**だったこと。つまりオーナーが
開いていたのは **グリッド由来の `item` スコープ ＝ 1 ページに 1 レコード**である。

  1. その 1 件を削除すると `deletedIds` に墓標が立つ
  2. `DishMediaFeed` は墓標を除いた結果が空になるので **`null` を返す**（黒いまま）
  3. ところが `MyDishesFeedPage` は **ストアの `feedIds`（墓標を含んだまま）** で数えて
     いたので `feedIds.length > 0` ＝ «中身がある» と判断し、ローディングでも 0 件でもない
     **«何も出ない» 状態で固定**されていた
  4. さらに取得の effect は `mediaIds.length === 0` で早期 return するため、
     **二度と取り直しも起きない**（実ログでも削除から次の取得まで 20 秒空いている）

## ここで固定すること

**削除済みを引いた «残り 0 件» を、ちゃんと 0 件として扱う。**
黒画面でもスピナーでもなく `my-dishes-feed-empty` が出ること。

⚠️ このテストは `DishMediaFeed` をモックしない。**あちらが墓標を見て `null` を返す**という
   前提込みで «親が何を出すか» を見たいので、本物を通す。モックへ戻すと、また
   «テストは緑・実機は固まる» に戻る。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
jest.mock("@/features/myDishes/components/MyDishesFeedChips", () => ({ MyDishesFeedChips: () => null }));
/*
⚠️ `callBackend` は **モジュール直下で 1 個だけ**作る。フック呼び出しのたびに `jest.fn()` を
作ると、呼ばれた回数がレンダーごとにリセットされて «再取得されたか» を数えられない。
*/
const mockCallBackend = jest.fn(async () => ({ items: [] as unknown[] }));
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ selectionChanged: jest.fn(), lightImpact: jest.fn() }),
}));
/*
`DishMediaContent` は動画プレイヤー（expo-video / expo-audio）を抱えており、
jest 環境では読み込めない。**ここで差し替えるのはセルの中身だけ**で、
`DishMediaFeed` 本体（墓標を見て `null` を返す側）は本物のまま通す。
*/
jest.mock("@/features/dishMedia/components/DishMediaContent", () => ({
	__esModule: true,
	default: () => null,
}));

// item スコープには «行» が無いので、派生クエリは両方とも空で構わない
const mockEmptyQuery = {
	items: [] as unknown[],
	queryKey: null,
	error: null,
	hasFetchedInitial: false,
	refresh: () => {},
};
jest.mock("@/features/myDishes/hooks/useMyDishesRestaurantQuery", () => ({
	useMyDishesRestaurantQuery: () => mockEmptyQuery,
}));
jest.mock("@/features/myDishes/hooks/useMyDishesDateQuery", () => ({
	useMyDishesDateQuery: () => mockEmptyQuery,
}));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { myDishesFeedKey } from "@/features/myDishes/constants";
import { MyDishesFeedPage } from "./MyDishesFeedPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM_KEY = "review:only-one";
const MEDIA_ID = "dm-only-one";

/** そのページに «その 1 件だけ» が入っている状態を作る（グリッド由来の item スコープ） */
function seedSingleEntry() {
	const key = myDishesFeedKey(`item:${ITEM_KEY}`);
	useDishMediaEntriesStore.setState((state) => ({
		...state,
		mediaIdsByKey: { ...state.mediaIdsByKey, [key]: [MEDIA_ID] },
		deletedIds: {},
	}));
	return key;
}

/**
 * その testID が描かれているか。
 *
 * ⚠️ `findAll` は合成要素とホスト要素を **二重に**数えるので、件数で assert しないこと
 * （最初にそう書いて «出ているのに落ちる» を作った）。有無だけを見る。
 */
function hasTestId(tree: TestRenderer.ReactTestRenderer, testID: string): boolean {
	return tree.root.findAll((node) => node.props?.testID === testID, { deep: true }).length > 0;
}

afterEach(() => {
	useDishMediaEntriesStore.setState((state) => ({
		...state,
		mediaIdsByKey: {},
		deletedIds: {},
		errorByKey: {},
		isLoadingByKey: {},
	}));
	mockCallBackend.mockClear();
});

/*
⚠️ **このテストが守れない範囲**（【35/40 再修正】で判明）。

削除で固まるもう 1 つの原因は «取得の決着（`settledKey`）が永久に立たず、ハイドレーション中の
スピナーが残る» ことだった。取得の effect の依存に取得中フラグが入っていたため、
`updateMediaIdsByKeyAsync` が同期的にそれを立てた瞬間にクリーンアップが走り、
決着の `.then` が捨てられていた。

**この筋は jest では再現しない。** `act` が途中のフラグ変化まで 1 バッチに畳んでしまい、
中間状態でのクリーンアップが起きないためである（修正前のコードでも緑になることを実測した）。
守っているのは `.claude/skills/evidence-video/scenarios/delete-last-item-1629.mjs`
（実ブラウザで削除まで押し切り、残るのがスピナーでないことを見る）である。
*/
describe("#1629【35/40】1 件だけのページで、その 1 件を削除したとき", () => {
	it("«残り 0 件» として扱い、何も出ないまま固まらない", async () => {
		seedSingleEntry();

		let tree: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			tree = TestRenderer.create(
				<MyDishesFeedPage
					scope={{ kind: "item", itemKey: ITEM_KEY, dishMediaId: MEDIA_ID, restaurantId: "restaurant-1" }}
					itemKey={ITEM_KEY}
					dishMediaId={MEDIA_ID}
					isActive
				/>,
			);
		});

		// `GET /v1/dish-media?ids=` の決着を待つ。待たないと «hydration 中 = ローディング» の
		// ままで、削除の影響ではなく取得待ちを見てしまう
		await act(async () => {
			await Promise.resolve();
		});

		/*
		⚠️ モックの `callBackend` は空応答なので、決着時に `updateMediaIdsByKeyAsync` が
		   ストアの ids を空へ上書きする。**実機では 1 件が入っている状態**なので、
		   ここで «取得できた 1 件» を置き直して実機と同じ前提に揃える。
		   （空応答のまま進めると «削除の影響» ではなく «取得できなかった» を見てしまう）
		*/
		act(() => {
			seedSingleEntry();
		});

		// 削除前は 0 件表示ではない（この前提が崩れると、下の assert が空振りする）
		expect(hasTestId(tree!, "my-dishes-feed-empty")).toBe(false);

		// 削除（墓標が立つ）。`feedIds` からは消えない — ここが今回の要点
		act(() => {
			useDishMediaEntriesStore.setState((state) => ({
				...state,
				deletedIds: { ...state.deletedIds, [MEDIA_ID]: true },
			}));
		});

		/*
		修正前はここで «何も出ない» まま固まっていた（`feedIds.length > 0` を根拠に
		DishMediaFeed を描き続け、その DishMediaFeed は墓標を除いて `null` を返す）。
		*/
		expect(hasTestId(tree!, "my-dishes-feed-empty")).toBe(true);
	});

	/*
	【35/40 再修正】取得の effect の依存から `mediaError` を外したので、**再試行が止まって
	いないこと**をここで固定する。

	外す前は «エラーが消えた» という依存の変化が偶然 «もう 1 回取り直す» の合図を兼ねていた。
	外したあとは `retryNonce` が明示的にその役をする。これが抜けると「失敗 → 再試行を押しても
	何も起きない」になり、しかも見た目は再試行ボタンのままなので気づきにくい。
	*/
	it("取得に失敗したあと、再試行を押すともう一度取りに行く", async () => {
		const key = seedSingleEntry();

		let tree: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			tree = TestRenderer.create(
				<MyDishesFeedPage
					scope={{ kind: "item", itemKey: ITEM_KEY, dishMediaId: MEDIA_ID, restaurantId: "restaurant-1" }}
					itemKey={ITEM_KEY}
					dishMediaId={MEDIA_ID}
					isActive
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		// 失敗した状態を作る（ストアのエラー ＋ 並びは空）
		act(() => {
			useDishMediaEntriesStore.setState((state) => ({
				...state,
				mediaIdsByKey: { ...state.mediaIdsByKey, [key]: [] },
				errorByKey: { ...state.errorByKey, [key]: "失敗しました" },
			}));
		});
		expect(hasTestId(tree!, "my-dishes-feed-error")).toBe(true);

		const callsBefore = mockCallBackend.mock.calls.length;
		const retry = tree!.root.find((node) => node.props?.testID === "my-dishes-feed-retry" && node.props?.onPress);
		await act(async () => {
			retry.props.onPress();
			await Promise.resolve();
		});

		expect(mockCallBackend.mock.calls.length).toBeGreaterThan(callsBefore);
	});
});
