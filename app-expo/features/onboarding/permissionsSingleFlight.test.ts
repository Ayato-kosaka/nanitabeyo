/*
#1736 【バグ】権限の説明画面が 2 枚同時に立つと、それぞれが OS へ許可を要求し、
Android は許可ダイアログを 2 回出していた（実測: ログイン経由のセッションだけ
`onboarding_location_permission_settled` が 2 回記録されていた）。

画面が 2 枚生えること自体は lib/authNext.ts 側で塞いだが、**OS へ届く要求の側**でも
1 本に畳んである（features/onboarding/permissions.ts の `singleFlight`）。
ここではその «畳み» を固定する。
*/
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

import { requestLocationPermission, requestNotificationPermission } from "./permissions";

jest.mock("expo-location", () => ({ requestForegroundPermissionsAsync: jest.fn() }));
jest.mock("expo-notifications", () => ({
	getPermissionsAsync: jest.fn(),
	requestPermissionsAsync: jest.fn(),
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;
const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;

describe("許可要求の二重発行", () => {
	it("位置情報: 進行中の要求があれば OS へは 1 回しか投げない", async () => {
		let answer: (value: { status: string }) => void = () => {};
		mockedLocation.requestForegroundPermissionsAsync.mockImplementation(
			() => new Promise((resolve) => (answer = resolve)) as any,
		);

		const first = requestLocationPermission();
		const second = requestLocationPermission();
		answer({ status: "granted" });

		expect(await first).toBe("granted");
		expect(await second).toBe("granted");
		expect(mockedLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
	});

	it("位置情報: 決着したあとの要求は改めて OS へ投げる（設定で許可へ変えて戻ってきた人のため）", async () => {
		mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" } as any);
		expect(await requestLocationPermission()).toBe("denied");

		mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" } as any);
		expect(await requestLocationPermission()).toBe("granted");
		expect(mockedLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
	});

	it("通知: 進行中の要求があれば OS へは 1 回しか投げない", async () => {
		mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined" } as any);
		let answer: (value: { status: string }) => void = () => {};
		mockedNotifications.requestPermissionsAsync.mockImplementation(
			() => new Promise((resolve) => (answer = resolve)) as any,
		);

		const first = requestNotificationPermission();
		const second = requestNotificationPermission();
		// getPermissionsAsync の解決を挟んでから答えさせる
		await Promise.resolve();
		await Promise.resolve();
		answer({ status: "granted" });

		expect(await first).toBe("granted");
		expect(await second).toBe("granted");
		expect(mockedNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
	});
});
