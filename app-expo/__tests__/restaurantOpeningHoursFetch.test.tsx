/*
#1666 営業時間の **取得側**（`useRestaurantOpeningHours`）を固定する。

⚠️ **取得が画面側にあること自体が、この機能の設計判断である。**
表示コンポーネントの中で `useAPICall` を呼ぶと、`SelectedRestaurantDetails` の
import グラフに `lib/supabase` が入り、この画面を描く既存テスト 3 本が
`supabaseUrl is required.` で **suite ごと落ちた**（実測）。
ここは «取得だけ» を、フックの単体として見る。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text } from "react-native";

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
	ApiError: class ApiError extends Error {},
}));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

import { useRestaurantOpeningHours } from "@/features/restaurant/hooks/useRestaurantOpeningHours";

const RESTAURANT_ID = "restaurant-1666";

const seen: (unknown | null)[] = [];

function Probe({ restaurantId }: { restaurantId?: string }) {
	const hours = useRestaurantOpeningHours(restaurantId);
	seen.push(hours);
	return <Text>{hours ? "loaded" : "empty"}</Text>;
}

const render = async (restaurantId?: string) => {
	await act(async () => {
		TestRenderer.create(<Probe restaurantId={restaurantId} />);
	});
	await act(async () => {});
};

beforeEach(() => {
	seen.length = 0;
	mockCallBackend.mockReset();
	mockLogFrontendEvent.mockReset();
});

describe("#1666 useRestaurantOpeningHours", () => {
	it("店の詳細を開いたら、営業時間の API を 1 回だけ叩く", async () => {
		mockCallBackend.mockResolvedValue({ days: [], sources: [], fetchedAt: null });
		await render(RESTAURANT_ID);

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith(
			`v1/restaurants/${RESTAURANT_ID}/opening-hours`,
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("取れた値をそのまま返す", async () => {
		const body = { days: [{ dayOfWeek: 1, spans: [] }], sources: ["osm"], fetchedAt: null };
		mockCallBackend.mockResolvedValue(body);
		await render(RESTAURANT_ID);

		expect(seen[seen.length - 1]).toEqual(body);
	});

	it("取得に失敗しても null のまま（画面は欄ごと出さない）。ただしログには必ず残す", async () => {
		/*
		⚠️ ここでスナックバーを出さないこと。営業時間は «あれば出す» 情報で、
		   店を開いただけでエラーが出る画面にしない。一方 **黙って消すのも駄目**で、
		   ログが無いと «誰も気づけない不具合» になる（CLAUDE.md「見えないものは «無い» ではない」）。
		*/
		mockCallBackend.mockRejectedValue(new Error("boom"));
		await render(RESTAURANT_ID);

		expect(seen[seen.length - 1]).toBeNull();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "restaurant_opening_hours_fetch_error",
				error_level: "warn",
			}),
		);
	});

	it("店 ID がまだ無いときは API を叩かない", async () => {
		await render(undefined);
		expect(mockCallBackend).not.toHaveBeenCalled();
	});
});
