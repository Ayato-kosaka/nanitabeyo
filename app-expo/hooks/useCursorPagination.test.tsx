/*
#1375（全画面のクラッシュ棚卸し）

**このフックが返す 3 つの関数は «参照が変わらない» ことと «いまの controller を叩く» ことの両方を守る。**

どちらか一方でも崩れると、実害のある不具合になる。

- 参照が毎レンダー変わる → `useFocusEffect` の依存に入れている画面（通知タブ）が
  effect → 取得 → 再レンダー → 新しい関数 → effect … と **API を無限に叩き続ける**
- 初回の controller を掴んだまま → `fetcher` が変わったあと呼んでも
  画面が見ている controller は更新されず **一覧が空のまま**になる

⚠️ ここが落ちたら、そのどちらかが戻っている。
*/
import React from "react";
import { act, create } from "react-test-renderer";
import { useCursorPagination } from "./useCursorPagination";

type Row = { id: string };

const makeFetcher = (rows: Row[]) => jest.fn(async () => ({ data: rows, nextCursor: null }));

/** フックの戻り値をレンダーごとに記録する足場 */
const renders: ReturnType<typeof useCursorPagination<Record<string, never>, Row>>[] = [];
function Harness({ fetcher }: { fetcher: ReturnType<typeof makeFetcher> }) {
	const result = useCursorPagination<Record<string, never>, Row>(fetcher as never);
	renders.push(result);
	return null;
}

beforeEach(() => {
	renders.length = 0;
});

it("refresh / loadMore / loadInitial の参照はレンダーをまたいで変わらない", async () => {
	const fetcher = makeFetcher([{ id: "a" }]);
	let tree!: ReturnType<typeof create>;
	await act(async () => {
		tree = create(<Harness fetcher={fetcher} />);
	});
	await act(async () => {
		tree.update(<Harness fetcher={fetcher} />);
	});

	expect(renders.length).toBeGreaterThan(1);
	const first = renders[0];
	const last = renders[renders.length - 1];
	expect(last.refresh).toBe(first.refresh);
	expect(last.loadMore).toBe(first.loadMore);
	expect(last.loadInitial).toBe(first.loadInitial);
});

it("fetcher を差し替えたあとの loadInitial は «新しい» fetcher を叩く", async () => {
	const oldFetcher = makeFetcher([{ id: "old" }]);
	const newFetcher = makeFetcher([{ id: "new" }]);
	let tree!: ReturnType<typeof create>;
	await act(async () => {
		tree = create(<Harness fetcher={oldFetcher} />);
	});
	await act(async () => {
		tree.update(<Harness fetcher={newFetcher} />);
	});

	// 初回レンダーで得た関数を、あえてそのまま使う（画面はこれを持ち続けるため）
	await act(async () => {
		await renders[0].loadInitial({});
	});

	expect(newFetcher).toHaveBeenCalled();
	expect(oldFetcher).not.toHaveBeenCalled();
	expect(renders[renders.length - 1].items).toEqual([{ id: "new" }]);
});
