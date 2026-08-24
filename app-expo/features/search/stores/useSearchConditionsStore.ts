import { createWithEqualityFn } from "zustand/traditional";

import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { SearchParams } from "@/types/search";
import type { priceLevelOptions } from "@/features/search/constants";

/**
 * #1375 実機確認（5 巡目）「保存スナックバーの『見る』で食べたい/食べたへ行き、
 * そのあと『探す』へ戻ると条件が初期化されている」への対処。
 *
 * ## なぜ画面の useState では足りないのか
 *
 * 検索結果は `transparentModal` で、保存の «見る» は `router.dismissAll()` で
 * モーダルを畳んでからタブを移す（#1401。畳まないとタブが動いて見えない）。
 * 畳んだ時点で結果画面は消え、条件を持っていた検索画面も作り直され得る。
 * その結果「入力し直し」になっていた。
 *
 * ## 何を持つか / 持たないか
 *
 * - **持つ**: 人が選んだ検索条件（場所・時間帯・シーン・詳細条件・距離・価格帯・詳細の開閉）
 * - **持たない**: 検索結果そのもの（大きい・鮮度が落ちる。結果は再検索で取り直す）
 *
 * 取得のキーには使わない。画面の初期値を «前回の続き» にするためだけの器である。
 * プロセスが生きている間だけ持てばよい（永続化しない）ので、AsyncStorage は使わない。
 */
export type SearchConditions = {
	location: Omit<LocationDetailsResponse, "viewport"> | null;
	locationQuery: string;
	timeSlot: SearchParams["timeSlot"];
	/**
	 * #1375（5 巡目・独立レビュー A-3）**人が時間帯を選んだか。**
	 *
	 * 「復元すべき条件がある」を «store が空でないか» で判定すると、初回マウントで
	 * 既定値を保存した瞬間に成立してしまい、2 度目のマウント（ロケール切替 /
	 * ErrorBoundary の復帰 / `router.replace("/")` 後）で
	 * **端末時刻に基づく時間帯の自動選択が二度と働かなくなる**。
	 * 自動選択を止めてよいのは «人が自分で選んだとき» だけなので、その事実を別に持つ。
	 */
	timeSlotTouched: boolean;
	scene: SearchParams["scene"];
	taste: SearchParams["taste"];
	coreIngredient: SearchParams["coreIngredient"];
	diningPace: SearchParams["diningPace"];
	distance: number;
	priceLevels: (typeof priceLevelOptions)[number]["value"][];
	showAdvancedFilters: boolean;
};

export type SearchConditionsStore = {
	/** 前回の条件。まだ一度も検索していなければ null（画面側の既定値を使う） */
	conditions: SearchConditions | null;
	save: (conditions: SearchConditions) => void;
	reset: () => void;
};

export const useSearchConditionsStore = createWithEqualityFn<SearchConditionsStore>()((set) => ({
	conditions: null,
	save: (conditions) => set({ conditions }),
	reset: () => set({ conditions: null }),
}));

/** レンダー外から読む（画面の初期値決定に使う） */
export const getSavedSearchConditions = (): SearchConditions | null => useSearchConditionsStore.getState().conditions;

/** レンダー外から書く（条件が変わるたびに呼ぶ） */
export const saveSearchConditions = (conditions: SearchConditions): void =>
	useSearchConditionsStore.getState().save(conditions);
