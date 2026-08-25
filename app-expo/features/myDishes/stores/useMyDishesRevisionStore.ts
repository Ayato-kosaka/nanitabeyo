import { createWithEqualityFn } from "zustand/traditional";
import { useMyDishesStore } from "./useMyDishesStore";

/**
 * #1398 (PR4/7) 「食べた」を記録したあとに my-dishes のキャッシュを捨てるための版数。
 *
 * ## なぜ必要か（設計 (1/2) §3「唯一の実務上の落とし穴：クライアントキャッシュ」）
 *
 * サーバ側は正しい。want 枝は `NOT EXISTS (SELECT 1 FROM dish_reviews …)` を持つので、
 * `dish_reviews` の行ができた瞬間にその dish の want 行は消える（`my-dishes.query.ts`）。
 * **save reaction を消さなくても消える。** しかしクライアントが取り直さなければ、
 * 記録した直後の画面には「食べたい」カードが残ったままに見える。ユーザーからはこれが
 * 「重複して表示されている」不具合に見える。
 *
 * ## なぜ «別 store» なのか
 *
 * `useMyDishesFilterStore` には入れない。あれは «ユーザーが明示的に選んだもの» だけを持つ
 * 契約で、キー集合は `__tests__/myDishesFilterStore.test.ts` が固定している。版数を混ぜると
 * `queryKey` が版数ごとに変わり、フィルタを触っていないのに 3 ビューが取り直す形になる。
 *
 * ## なぜ «queryKey に版数を混ぜない» のか（PR4 の地雷 (b)）
 *
 * `MY_DISHES_QUERY_LRU_SIZE` は 6 本しかない。版数を `queryKey` の一部にすると、記録するたびに
 * 新しいキーが生まれ、**古い版のスライスが LRU を食い潰して base の一覧が追い出される**。
 * そこで版数はキーに混ぜず、`bump()` が `clearQuery()` でスライスを丸ごと捨てる形にした。
 * 捨てられたキーは `hasFetchedInitial` も `error` も消えるので、マウント中のフックは既存の
 * `!error` ガード付き effect がそのまま取り直す（**新しい取得経路を足していない**）。
 *
 * ## なぜ «その店だけ» ではなく全部捨てるのか
 *
 * 1 件の記録は「want が 1 行消えて eaten が 1 行増える」変化であり、base の一覧・Map のピン・
 * Calendar の月・他店の Sheet のいずれにも波及しうる（`meta.oldestOccurredAt` も動く）。
 * 部分無効化にすると «どのキーが影響を受けるか» をクライアントで再現することになり、
 * サーバの SQL と二重管理になる。**全部捨てるのが唯一ズレない**。捨てても失うのは
 * キャッシュだけで、次の描画で取り直される。
 */
export type MyDishesRevisionStore = {
	/**
	 * 無効化が起きた回数。**取得キーには使わない**（上記の理由）。
	 * フックはこれを effect の依存に持ち、版が動いたことを検知できるようにしている。
	 */
	revision: number;
	/**
	 * my-dishes のキャッシュを捨てて版を 1 つ進める。
	 * 呼ぶのは `review.tsx` / `review-from-media/[dishMediaId].tsx` の `handleReviewSuccess` と、
	 * #1513 で足した `OwnPostActions`（自分の投稿の編集・削除）である。いずれも
	 * **その変更を起こした当人**が呼ぶ形にしている。
	 * **`ReviewForm` からは呼ばない**（ReviewForm を my-dishes に結合させないため。設計 §3）。
	 */
	bump: () => void;
};

export const useMyDishesRevisionStore = createWithEqualityFn<MyDishesRevisionStore>()((set) => ({
	revision: 0,

	bump: () => {
		// 先にスライスを捨ててから版を進める。逆順にすると、版の変化で再描画されたフックが
		// «まだ捨てられていない古いスライス»（`hasFetchedInitial === true`）を見て取り直さない
		useMyDishesStore.getState().clearQuery();
		set((state) => ({ revision: state.revision + 1 }));
	},
}));

export const selectMyDishesRevision = (s: MyDishesRevisionStore): number => s.revision;

/** 画面から呼ぶための薄い口。`useMyDishesRevisionStore.getState().bump()` と同じ */
export const bumpMyDishesRevision = (): void => useMyDishesRevisionStore.getState().bump();
