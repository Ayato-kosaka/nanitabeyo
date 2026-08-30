import { createWithEqualityFn } from "zustand/traditional";

import type { Region } from "@/components/MapView";

/**
 * #1375 実機確認（5 巡目）「Map を拡大 → リストへ行って戻ると全国まで引かれる」への対処。
 *
 * ## なぜ store なのか（コンポーネントの ref では足りない）
 *
 * 3 ビューは keep-alive だが、タブを離れる・アプリを戻す等で Map が作り直される経路がある。
 * ref はその瞬間に消えるので «人が最後に見ていた場所» を画面の外に置く必要がある。
 *
 * ## ⚠️ `useMyDishesFilterStore` には絶対に入れない（#1396 設計 (2/2) §3-2）
 *
 * あちらは `queryKey` の材料であり、viewport を混ぜると pan / zoom のたびに 3 ビューが
 * 964MB の `dish_reviews` へ取り直しに行く。**この store は取得に一切関与しない**。
 * 読むのは Map の初期表示だけで、書くのは `onRegionChangeComplete`（人の操作の結果）だけである。
 *
 * ## 何を防ぐための値か
 *
 * `region` が入っている限り、Map は **現在地の自動センタリングもピンの外接矩形フィットも行わない**。
 * 自動の初期化は «まだ人が一度も動かしていない» ときの補助であって、人が選んだ表示域より優先しない。
 */
export type MyDishesViewportStore = {
	/** 人が最後に見ていた表示域。まだ一度も動かしていなければ null */
	region: Region | null;
	setRegion: (region: Region) => void;
	/** テストと «記録の作り直し» のためのリセット（通常の画面遷移では呼ばない） */
	reset: () => void;
};

export const useMyDishesViewportStore = createWithEqualityFn<MyDishesViewportStore>()((set) => ({
	region: null,
	setRegion: (region) => set({ region }),
	reset: () => set({ region: null }),
}));

/** レンダー外（コールバック）から読む用 */
export const getMyDishesViewportRegion = (): Region | null => useMyDishesViewportStore.getState().region;

/** レンダー外（コールバック）から書く用 */
export const setMyDishesViewportRegion = (region: Region): void =>
	useMyDishesViewportStore.getState().setRegion(region);
