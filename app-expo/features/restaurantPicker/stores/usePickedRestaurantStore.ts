/*
このファイルの責務
- 「地図でお店を 1 件選んだ」という結果を、**選んだ画面から呼び出し元へ 1 回だけ渡す**。

## なぜ store なのか（#1375 実機確認）

SNS 取り込み画面で店名検索が空振りしたときの逃げ道は「地図のお店をタップする」である。
ところが取り込み画面には地図が無く、地図を持っているのは別ルート
（`app/[locale]/sns-import-pick-restaurant.tsx`）なので、
**選んだ結果を戻り先へ渡す手段**が要る。

- URL のクエリに載せて `router.back()` … expo-router の `back()` はパラメータを持てない
- `router.replace` で取り込み画面を作り直す … 貼り付け済みの URL と選択済みの料理が消える

したがって «画面を跨ぐ 1 回きりの受け渡し» を、この極小 store が持つ。
**読んだ側が必ず `consume()` して捨てる**（残すと、次に取り込み画面を開いたときに
前回の選択が黙って復活する）。永続化しない。
*/
import { create } from "zustand";
import type { RestaurantsEntity } from "@shared/api/v1/res";

export type PickedRestaurant = {
	restaurantId: string;
	name: string;
	/**
	 * #1375（3 巡目）食べたを記録の統合フォームは `ReviewForm` に **restaurants の行そのもの**を
	 * 渡す必要がある（通貨コード等を読む）。地図側は持っているので一緒に運ぶ。
	 * SNS 取り込みのように id と名前しか要らない受け手は無視してよい
	 */
	restaurant?: RestaurantsEntity;
};

type PickedRestaurantStore = {
	picked: PickedRestaurant | null;
	/** 地図側が選んだ結果を置く */
	setPicked: (picked: PickedRestaurant) => void;
	/** 呼び出し元が受け取って捨てる。受け取れなければ null */
	consume: () => PickedRestaurant | null;
};

export const usePickedRestaurantStore = create<PickedRestaurantStore>((set, get) => ({
	picked: null,
	setPicked: (picked) => set({ picked }),
	consume: () => {
		const { picked } = get();
		if (picked === null) return null;
		set({ picked: null });
		return picked;
	},
}));
