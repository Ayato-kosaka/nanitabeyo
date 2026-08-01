// #1120 【設計】useEnsureOwnProfileLoaded が返す「決着したか」の意味を固定するテスト。
//
// 呼び出し側（DishCategoryGroupVoteCompletionModal）は、この値が false の間はゲスト向け UI を
// 描かずに待つ。つまりここが「取得前から true」になると #1120 のちらつきが再発し、
// 逆に「取得後も false のまま」になると UI がローディングで固着する。両方向を赤で守る。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

let mockUser: { id: string; is_anonymous?: boolean } | null = null;
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: mockUser }) }));

/** callBackend の解決タイミングをテストから握る */
let mockResolveProfile: (value: unknown) => void;
const mockCallBackend = jest.fn(
	() =>
		new Promise((resolve) => {
			mockResolveProfile = resolve;
		}),
);
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/features/profile/hooks/useProfile", () => ({ useProfile: () => ({ createUserProfile: jest.fn() }) }));
jest.mock("expo-image", () => ({ Image: { prefetch: jest.fn(() => Promise.resolve(true)) } }));
jest.mock("@/data/profileData", () => ({ userProfile: { display_name: "guest" } }));

import { useEnsureOwnProfileLoaded } from "./useEnsureOwnProfileLoaded";
import { useProfileStore } from "../stores/useProfileStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックの戻り値を毎レンダー記録するだけのハーネス */
let latest: { isProfileResolved: boolean };
function Harness() {
	latest = useEnsureOwnProfileLoaded();
	return null;
}

beforeEach(() => {
	useProfileStore.getState().resetProfile();
	mockCallBackend.mockClear();
});

describe("useEnsureOwnProfileLoaded の isProfileResolved", () => {
	it("ログインユーザーでは、プロフィール取得が終わるまで false のまま", async () => {
		mockUser = { id: "user-1", is_anonymous: false };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		// API のレスポンス待ち = まだ display_name が分からない
		expect(mockCallBackend).toHaveBeenCalled();
		expect(latest.isProfileResolved).toBe(false);

		await act(async () => {
			mockResolveProfile({ display_name: "ログイン太郎", avatarUrls: undefined });
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toEqual({ display_name: "ログイン太郎", avatarUrls: undefined });
	});

	it("ゲストユーザーでは API を待たずに決着する", async () => {
		mockUser = { id: "guest-1", is_anonymous: true };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(latest.isProfileResolved).toBe(true);
	});

	it("プロフィール取得が失敗しても決着する（ローディングで固着させない）", async () => {
		mockUser = { id: "user-2", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toBeNull();
	});
});
