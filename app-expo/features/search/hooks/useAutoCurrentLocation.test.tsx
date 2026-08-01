import { act } from "react";
import TestRenderer from "react-test-renderer";
import type { User } from "@supabase/supabase-js";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { ApiError } from "@/hooks/useAPICall";
import { LocationPermissionError } from "@/hooks/locationPermissionError";
import { useAutoCurrentLocation } from "./useAutoCurrentLocation";

/**
 * #1092 C4 の感度テスト: **現在地の自動取得は「一度きり」で終わらせない**。
 *
 * 検索画面（= 初期画面）の現在地自動取得は `didInitTutorialState` の一度きりガードの
 * 内側から呼ばれる。取得は逆ジオコーディング API を経由するため JWT を要求し、
 * 認証がまだ確立していないと必ず失敗する。以前はその失敗を warn ログに落とすだけだったので、
 * **その起動では現在地が二度と入らなかった**（ja かつチュートリアル既読 = リピーターの大半と、
 * 非 ja の全員が該当する）。
 *
 * ここでは「トークンが無いだけの失敗なら auth 解決後に 1 回だけ取り直す」ことと、
 * 「権限拒否など取り直しても直らない失敗では取り直さない」ことの両方を固定する。
 */

/** 現在の user。null = 認証がまだ確立していない */
let mockUser: Pick<User, "id"> | null = null;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser }),
}));
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});

type CurrentLocation = Omit<LocationDetailsResponse, "viewport">;

const fakeLocation = { location: { latitude: 35.68, longitude: 139.76 } } as unknown as CurrentLocation;

const unauthenticatedError: ApiError = {
	code: "unauthenticated",
	message: "User is not authenticated: Supabase access_token is missing (endpoint: v1/locations/reverse-geocoding).",
};

describe("#1092 検索画面の現在地自動取得は auth 解決後に取り直す", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	const getCurrentLocation = jest.fn<Promise<CurrentLocation>, []>();
	const onResolved = jest.fn();

	/** フックだけをレンダリングし、要求（= チュートリアル分岐からの呼び出し）を再現する */
	const Probe = () => {
		const { requestAutoCurrentLocation } = useAutoCurrentLocation({ getCurrentLocation, onResolved });
		requestRef = requestAutoCurrentLocation;
		return null;
	};
	let requestRef: () => void;

	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(<Probe />);
		});
	};

	/** 匿名サインインが後から成功した状況を作る */
	const resolveAuth = async (userId: string) => {
		mockUser = { id: userId };
		await act(async () => {
			renderer.update(<Probe />);
		});
	};

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockUser = null;
	});

	it("トークンが無くて失敗したら、auth の解決で 1 回だけ取り直す", async () => {
		getCurrentLocation.mockRejectedValueOnce(unauthenticatedError).mockResolvedValueOnce(fakeLocation);

		await mount();
		await act(async () => {
			requestRef();
		});
		expect(getCurrentLocation).toHaveBeenCalledTimes(1);
		expect(onResolved).not.toHaveBeenCalled();

		// ここで取り直さないと、この起動では現在地が二度と入らない
		await resolveAuth("anon-1");
		expect(getCurrentLocation).toHaveBeenCalledTimes(2);
		expect(onResolved).toHaveBeenCalledWith(fakeLocation);
	});

	it("取得できた後は、user が変わっても取り直さない（ユーザーが選び直した地点を上書きしない）", async () => {
		getCurrentLocation.mockResolvedValue(fakeLocation);

		await mount();
		await act(async () => {
			requestRef();
		});
		expect(getCurrentLocation).toHaveBeenCalledTimes(1);

		await resolveAuth("anon-1");
		expect(getCurrentLocation).toHaveBeenCalledTimes(1);
	});

	it("位置情報の権限拒否など、取り直しても直らない失敗では取り直さない", async () => {
		getCurrentLocation.mockRejectedValue(new LocationPermissionError("denied", "location permission denied"));

		await mount();
		await act(async () => {
			requestRef();
		});
		expect(getCurrentLocation).toHaveBeenCalledTimes(1);

		await resolveAuth("anon-1");
		expect(getCurrentLocation).toHaveBeenCalledTimes(1);
	});

	it("要求されていなければ、auth が解決しても勝手に取得しない（チュートリアル未読で現在地を取らない仕様を守る）", async () => {
		getCurrentLocation.mockResolvedValue(fakeLocation);

		await mount();
		await resolveAuth("anon-1");

		expect(getCurrentLocation).not.toHaveBeenCalled();
	});

	it("再試行も失敗したら、そこで打ち切る（user の変化のたびに叩き続けない）", async () => {
		getCurrentLocation.mockRejectedValue(unauthenticatedError);

		await mount();
		await act(async () => {
			requestRef();
		});
		await resolveAuth("anon-1");
		expect(getCurrentLocation).toHaveBeenCalledTimes(2);

		await resolveAuth("user-1");
		expect(getCurrentLocation).toHaveBeenCalledTimes(2);
	});
});
