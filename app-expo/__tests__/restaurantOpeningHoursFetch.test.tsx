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
		/*
		⚠️ **応答は毎回 «新しいオブジェクト» を返すこと。**

		同じ参照を返すと `setHours` で React が再レンダリングを打ち切るので、
		**取得が毎レンダリング走る作りになっていてもこのテストは緑になる**。
		実際、最初に書いた版は `mockResolvedValue({...})`（同じ参照）で、
		再取得ループを 1 つも検出できなかった。

		このアプリは #1629 で «リクエストの洪水» による 40 秒問題を踏んでいる。
		店舗詳細を開くたびに営業時間を無限に引くのは、同じ形の事故である。
		*/
		mockCallBackend.mockImplementation(() =>
			Promise.resolve({ days: [], sources: [], fetchedAt: null }),
		);
		await render(RESTAURANT_ID);

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith(
			`v1/restaurants/${RESTAURANT_ID}/opening-hours`,
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("応答が毎回 «別のオブジェクト» でも、取得は 1 回で止まる（再取得ループを作らない）", async () => {
		/*
		⚠️ `useEffect` の依存に **安定していない関数**が混ざると、
		   fetch → setState → 再レンダリング → 依存が変わる → fetch … と回り続ける。

		`callBackend`（`useCallback`）と `logFrontendEvent`（deps 空）はどちらも安定なので
		いまは回らない。**それが崩れたらここが赤くなる**ようにしておく
		（同じ画面の `GET /v1/restaurants/:id` も同じ形の useEffect を使っている）。
		*/
		mockCallBackend.mockImplementation(() =>
			// 毎回 «別の» オブジェクト。同じ参照だと React が再レンダリングを打ち切ってしまう
			Promise.resolve({ days: [{ dayOfWeek: 1, spans: [] }], sources: ["osm"], fetchedAt: null }),
		);
		await render(RESTAURANT_ID);
		// レンダリングが落ち着くまで、もう数回まわす
		for (let i = 0; i < 5; i++) {
			await act(async () => {});
		}

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
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
