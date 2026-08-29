import { useCallback, useEffect, useRef, useState } from "react";

import { resolveDishCategoryLabel } from "@/features/myDishes/dishCategoryLabel";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogString } from "@/lib/errorMessage";
import type { QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";

/**
 * #1375 実機確認（5 巡目）「料理カテゴリーは **縦スクロールで選びたい**。その上に検索ボックス」。
 *
 * ## なぜ «その店の料理» を出すのか
 *
 * 従来この画面は「打たないと何も出ない」検索欄だけだった。記録しようとしている料理の名前を
 * 正確に打てる人ばかりではないし、**その店で誰かが既に記録している料理**は候補として一番当たる。
 * 空欄のあいだはそれを縦に並べ、打ち始めたら従来どおり全体から検索する。
 *
 * ## API は増やさない
 *
 * `GET /v1/restaurants/:id/dish-media`（店舗フィードが使う既存の 1 本）の 1 ページから
 * `dish.category_id` / `dish.name` を数えて畳む。my-dishes の絞り込みが «いま出ている記録から
 * カテゴリ候補を作る»（#1375 3 巡目）のと同じ作法で、そのための専用エンドポイントは作らない。
 *
 * ## 失敗は静かに縮退する
 *
 * これは «あると当たりやすい候補» であって、この画面の機能ではない（検索欄で必ず選べる）。
 * 失敗したら候補ゼロとして扱い、エラーは出さない（ログだけ残す）。
 */
export type RestaurantDishCategory = {
	dishCategoryId: string;
	label: string;
	/** その店でこのカテゴリの記録が何件あるか（多い順に並べるため） */
	count: number;
};

export function useRestaurantDishCategories(restaurantId: string | undefined) {
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const [categories, setCategories] = useState<RestaurantDishCategory[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	// 1 画面につき 1 回だけ引く（戻ってきたときに再取得しない）
	const hasFetchedRef = useRef(false);

	const fetch = useCallback(async () => {
		if (!restaurantId || hasFetchedRef.current) return;
		hasFetchedRef.current = true;
		setIsLoading(true);
		try {
			const response = await callBackend<Record<string, never>, QueryRestaurantDishMediaResponse>(
				`v1/restaurants/${restaurantId}/dish-media`,
				{ method: "GET", requestPayload: {} },
			);
			const counts = new Map<string, RestaurantDishCategory>();
			for (const entry of response.data) {
				const dishCategoryId = entry.dish.category_id;
				// カテゴリが無い行は候補にできない（選んでも id を返せない）
				if (!dishCategoryId) continue;
				const existing = counts.get(dishCategoryId);
				if (existing) {
					existing.count += 1;
					continue;
				}
				/*
				#1629【オーナー実機報告】「このお店の料理が **9483163** って出てる」。

				表示名を `entry.dish.name || dishCategoryId` にしていたため、その店での呼び名が
				空の行では **カテゴリ id がそのまま画面に出ていた**。しかもそれを選ぶと id が
				«料理の名前» として下流へ流れ、フォームの料理カテゴリー欄が壊れる。

				表示名の解決は `dishCategoryLabel.ts` の規則（`labels[言語] → labels["en"] → name`）に
				従い、**id へは絶対に落とさない**（あそこにも「labels を «無ければ QID» に
				落とさないこと」と書いてある）。名前が 1 つも無い行は «押せる候補» にできないので
				候補から外す。検索欄から自由入力で決める道が別にあるので、行き止まりにはならない。
				*/
				const label = resolveDishCategoryLabel(entry.dish.categoryLabels, entry.dish.name, locale);
				if (!label) continue;
				counts.set(dishCategoryId, { dishCategoryId, label, count: 1 });
			}
			// 多い順 → 同数はラベル順（取得のたびに並びが変わらないように）
			setCategories([...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)));
		} catch (error) {
			logFrontendEvent({
				event_name: "restaurant_dish_categories_failed",
				error_level: "warn",
				payload: { restaurant_id: restaurantId, error: toErrorLogString(error) },
			});
			setCategories([]);
		} finally {
			setIsLoading(false);
		}
	}, [callBackend, locale, logFrontendEvent, restaurantId]);

	useEffect(() => {
		void fetch();
	}, [fetch]);

	return { categories, isLoading };
}
