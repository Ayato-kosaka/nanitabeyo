/*
#1666 店舗詳細に出す «通常の 1 週間の営業時間» を取ってくる。

## ⚠️ なぜ取得を «画面» 側に置き、表示コンポーネントに置かないのか

最初は `RestaurantOpeningHours` の中で `useAPICall` を呼んでいたが、それだと
**`SelectedRestaurantDetails` の import グラフに `useAPICall` → `AuthProvider` →
`lib/supabase` が入る**。`lib/supabase` は import した瞬間に `Env.SUPABASE_URL` を
検証して throw するので、この画面を描く既存テスト 3 本が
`supabaseUrl is required.` で **suite ごと落ちた**（描画の中身とは無関係に）。

データ取得は画面（`app/[locale]/restaurant/[restaurantId].tsx`）が持ち、
表示コンポーネントは受け取った値を描くだけにする。店の実体（`restaurantEntry`）が
すでにそうなっているので、同じ形に揃うことになる。
*/
import { useCallback, useEffect, useState } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantOpeningHoursResponse } from "@shared/api/v1/res";

/**
 * 取れていないあいだ・取れなかったときは `null`。
 * 呼び出し側は «欄ごと出さない» ので、読み込み中の骨組みも出さない
 * （あるかどうか分からないものの場所を先に空けない）。
 */
export function useRestaurantOpeningHours(
	restaurantId: string | undefined,
): GetRestaurantOpeningHoursResponse | null {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const [hours, setHours] = useState<GetRestaurantOpeningHoursResponse | null>(null);

	const load = useCallback(async () => {
		if (!restaurantId) return;
		try {
			const response = await callBackend<Record<string, never>, GetRestaurantOpeningHoursResponse>(
				`v1/restaurants/${restaurantId}/opening-hours`,
				{ method: "GET", requestPayload: {} },
			);
			setHours(response);
		} catch (error) {
			/*
			⚠️ 取れなくても画面を壊さない。営業時間は «あれば出す» 情報で、
			   ここでスナックバーを出すと «店を開いただけでエラーが出る» ことになる。
			   握り潰すのではなく、必ずログには残す（黙って消えると気づけない）。
			*/
			logFrontendEvent({
				event_name: "restaurant_opening_hours_fetch_error",
				error_level: "warn",
				payload: { restaurant_id: restaurantId, error: error instanceof Error ? error.message : "Unknown" },
			});
		}
	}, [callBackend, logFrontendEvent, restaurantId]);

	useEffect(() => {
		load();
	}, [load]);

	return hours;
}
