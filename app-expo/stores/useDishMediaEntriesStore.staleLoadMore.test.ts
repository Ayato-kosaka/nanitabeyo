import { useDishMediaEntriesStore } from "./useDishMediaEntriesStore";
import { useDishCategoriesStore } from "./useDishCategoriesStore";

/**
 * #1599 **引っ張って更新に追い抜かれた追加取得が、古いページを混ぜ込む件。**
 *
 * `fetchInitialByKey`（引っ張って更新）と `fetchMoreByKey`（もっと読む）は
 * ロード中フラグが別（`isLoadingByKey` / `isLoadingMoreByKey`）で、
 * 互いの飛行中を見ていないので **並走できる**。
 *
 *   1. 下端まで送って追加取得（cursor=C1）が飛ぶ
 *   2. 返る前に引っ張って更新 → 一覧が新しい 1 ページ目に入れ替わる
 *   3. **遅れて返った C1 の応答**が、入れ替わった後の一覧の末尾へ «更新前のページ» を
 *      追記し、さらに `nextCursor` を «更新前の連鎖» の値で上書きする
 *
 * 実害: いいねを外して引っ張って更新したのに、外した投稿が末尾に復活する。
 * 以降の「もっと読む」は画面と別系統のカーソルを辿るので、重複や欠落も起きる。
 */

const KEY = "profileLikes";

/** 応答のタイミングを外から握るための門 */
function gate<T>() {
	let release!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

const entry = (id: string) =>
	({
		dish_media: { id, dish_id: `dish-${id}`, user_id: "u1" },
		restaurant: { id: "r1", name: "テスト店" },
		dish: { id: `dish-${id}` },
		dish_reviews: [],
	}) as never;

const idsOf = () => useDishMediaEntriesStore.getState().mediaIdsByKey[KEY] ?? [];
const cursorOf = () => useDishMediaEntriesStore.getState().nextCursorByKey[KEY];

describe("#1599 追加取得が引っ張って更新に追い抜かれたとき", () => {
	beforeEach(() => {
		useDishMediaEntriesStore.getState().clearByKey();
	});

	it("遅れて返った古いページを一覧へ混ぜない", async () => {
		// 1 ページ目（old-1, old-2）が出ている状態を作る
		await useDishMediaEntriesStore
			.getState()
			.fetchInitialByKey(KEY, {}, async () => ({ data: [entry("old-1"), entry("old-2")], nextCursor: "C1" }));
		expect(idsOf()).toEqual(["old-1", "old-2"]);
		expect(cursorOf()).toBe("C1");

		// 下端まで送って追加取得（cursor=C1）。まだ返さない
		const more = gate<{ data: never[]; nextCursor: string | null }>();
		const morePromise = useDishMediaEntriesStore
			.getState()
			.fetchMoreByKey(KEY, {}, async () => more.promise as never);

		// 返る前に引っ張って更新。old-2 は «いいねを外した» ので消えている
		await useDishMediaEntriesStore
			.getState()
			.fetchInitialByKey(KEY, {}, async () => ({ data: [entry("fresh-1")], nextCursor: "C-FRESH" }));
		expect(idsOf()).toEqual(["fresh-1"]);

		// ここで遅れて C1 の応答が返る
		more.release({ data: [entry("old-3")] as never[], nextCursor: "C2" });
		await morePromise;

		// 更新前のページが末尾へ紛れ込まないこと
		expect(idsOf()).toEqual(["fresh-1"]);
		// nextCursor も «更新前の連鎖» の値で上書きされないこと。
		// ここが上書きされると、以降の「もっと読む」が画面と別系統を辿る
		expect(cursorOf()).toBe("C-FRESH");
	});

	it("追い抜かれていなければ、これまでどおり末尾へ追記する", async () => {
		await useDishMediaEntriesStore
			.getState()
			.fetchInitialByKey(KEY, {}, async () => ({ data: [entry("a")], nextCursor: "C1" }));

		await useDishMediaEntriesStore
			.getState()
			.fetchMoreByKey(KEY, {}, async () => ({ data: [entry("b")], nextCursor: "C2" }) as never);

		expect(idsOf()).toEqual(["a", "b"]);
		expect(cursorOf()).toBe("C2");
	});

	it("全体リセット（ログアウト）でも飛行中の追加取得を捨てる", async () => {
		await useDishMediaEntriesStore
			.getState()
			.fetchInitialByKey(KEY, {}, async () => ({ data: [entry("a")], nextCursor: "C1" }));

		const more = gate<{ data: never[]; nextCursor: string | null }>();
		const morePromise = useDishMediaEntriesStore
			.getState()
			.fetchMoreByKey(KEY, {}, async () => more.promise as never);

		// ログアウト相当（AuthProvider が呼ぶ）
		useDishMediaEntriesStore.getState().clearByKey();

		more.release({ data: [entry("b")] as never[], nextCursor: "C2" });
		await morePromise;

		// 消したはずの一覧が «前のユーザーのデータ» で復活しないこと
		expect(idsOf()).toEqual([]);
	});

	it("別のキーを片付けても、このキーの追加取得は捨てない（巻き添えにしない）", async () => {
		// 判定を «カーソルが今も現在値か» にしたので、無関係なキーの clearByKey では
		// 捨てられない。画面遷移のたびに他のタブの「もっと読む」が黙って消える、
		// という副作用を避けるための性質なので、ここで固定しておく
		await useDishMediaEntriesStore
			.getState()
			.fetchInitialByKey(KEY, {}, async () => ({ data: [entry("a")], nextCursor: "C1" }));

		const more = gate<{ data: never[]; nextCursor: string | null }>();
		const morePromise = useDishMediaEntriesStore
			.getState()
			.fetchMoreByKey(KEY, {}, async () => more.promise as never);

		// 別画面のアンマウント相当（cleanup で自分のキーだけ片付ける）
		useDishMediaEntriesStore.getState().clearByKey("some-other-screen");

		more.release({ data: [entry("b")] as never[], nextCursor: "C2" });
		await morePromise;

		expect(idsOf()).toEqual(["a", "b"]);
	});
});

/**
 * #1599 同じ欠陥が `useDishCategoriesStore` にも同じ形であった。
 * 一方だけ直すと、もう一方で同じ «外したはずのものが末尾に復活する» が残る。
 */
describe("#1599 useDishCategoriesStore も同じ形で守る", () => {
	beforeEach(() => {
		useDishCategoriesStore.getState().clearByKey();
	});

	const CAT_KEY = "savedDishCategories";
	const cat = (id: string) => ({ id, label: id }) as never;
	const catIds = () => useDishCategoriesStore.getState().dishCategoryIdsByKey[CAT_KEY] ?? [];

	it("遅れて返った古いページを一覧へ混ぜない", async () => {
		await useDishCategoriesStore
			.getState()
			.fetchInitialByKey(CAT_KEY, {}, async () => ({ data: [cat("old-1")], nextCursor: "C1" }) as never);
		expect(catIds()).toEqual(["old-1"]);

		let release!: (v: unknown) => void;
		const pending = new Promise((resolve) => {
			release = resolve;
		});
		const morePromise = useDishCategoriesStore
			.getState()
			.fetchMoreByKey(CAT_KEY, {}, async () => pending as never);

		await useDishCategoriesStore
			.getState()
			.fetchInitialByKey(CAT_KEY, {}, async () => ({ data: [cat("fresh-1")], nextCursor: "C-FRESH" }) as never);

		release({ data: [cat("old-2")], nextCursor: "C2" });
		await morePromise;

		expect(catIds()).toEqual(["fresh-1"]);
		expect(useDishCategoriesStore.getState().nextCursorByKey[CAT_KEY]).toBe("C-FRESH");
	});
});
