/**
 * #856 【責務】
 * 結果画面表示中の GET detail を 5 秒間隔で polling する。
 *
 * refresh 完了後に次回を予約し、通信が長引いた場合の並列 GET を避ける。
 */
import { useEffect } from "react";
import type { AppStateStatus } from "react-native";

type UseDishCategoryGroupVotePollingParams = {
	isFocused: boolean;
	appState: AppStateStatus;
	refresh: () => Promise<unknown>;
};

export function useDishCategoryGroupVotePolling({
	isFocused,
	appState,
	refresh,
}: UseDishCategoryGroupVotePollingParams) {
	useEffect(() => {
		if (!isFocused || appState !== "active") return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const tick = async () => {
			try {
				await refresh();
			} catch {
				// 既存データを維持し、次回 polling で自然回復を待つ。
			}

			if (!cancelled) {
				timer = setTimeout(tick, 5_000);
			}
		};

		void tick();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [appState, isFocused, refresh]);
}
