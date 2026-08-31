// #1370 【設計】LoginForm が `next`（ログイン後の行き先）を OAuth 呼び出しへ «そのまま渡す» ことを固定する。
//
// next は login ルート → LoginForm → AuthProvider の redirectTo → callback、という順に URL まで運ばれる。
// この鎖のどこか 1 箇所が落ちても症状は同じ「web でログインすると必ずマイページに着地する」で、
// しかも実際の OAuth を通さないと踏めないため E2E でも気付けない。鎖の各段を別々に固定する。
//
// - login ルート → LoginForm: __tests__/loginScreenAuthGate.test.tsx
// - AuthProvider → redirectTo: contexts/authProviderOAuthNext.test.tsx
// - callback → 遷移 / 2 周目: __tests__/authCallbackScreen.test.tsx
// - ここ: LoginForm → linkIdentity / signInWithOAuth（昇格経路と既存ログイン経路の «両方»）
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

let mockUser: { id: string; is_anonymous?: boolean } | null = null;
const mockSignInWithOAuth = jest.fn();
const mockLinkIdentity = jest.fn();
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		user: mockUser,
		signInWithOAuth: (provider: string, options?: unknown) => mockSignInWithOAuth(provider, options),
		linkIdentity: (provider: string, options?: unknown) => mockLinkIdentity(provider, options),
	}),
}));

jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/features/settings/components/LegalDocument", () => ({ LegalDocument: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));

// 押下の観測だけが目的なので、ボタンは testID と onPress を持つ素の View に差し替える
jest.mock("@/components/PrimaryButton", () => {
	const { View } = jest.requireActual("react-native");
	const ReactActual = jest.requireActual("react");
	return {
		PrimaryButton: (props: { testID?: string; onPress: () => void }) =>
			ReactActual.createElement(View, { testID: props.testID, onPress: props.onPress }),
	};
});

import { LoginForm } from "./LoginForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pressGoogle = async (next?: string) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<LoginForm testID="login-screen" next={next} />);
	});
	const button = tree.root.find((node) => node.props?.testID === "login-google-button");
	await act(async () => {
		await button.props.onPress();
	});
};

beforeEach(() => {
	mockSignInWithOAuth.mockResolvedValue({ outcome: "returned" });
	mockLinkIdentity.mockResolvedValue({ outcome: "returned" });
});

describe("#1370 LoginForm が next を OAuth 経路へ渡す", () => {
	// 匿名ユーザーの «昇格» 経路（linkIdentity）。競合したときは callback 側が 2 周目を回す
	it("昇格（linkIdentity）に next を渡す", async () => {
		mockUser = { id: "guest-1", is_anonymous: true };

		await pressGoogle("/ja-JP/(tabs)/review");

		expect(mockLinkIdentity).toHaveBeenCalledWith("google", { next: "/ja-JP/(tabs)/review" });
		expect(mockSignInWithOAuth).not.toHaveBeenCalled();
	});

	it("既存ログイン（signInWithOAuth）に next を渡す", async () => {
		mockUser = { id: "user-1", is_anonymous: false };

		await pressGoogle("/ja-JP/(tabs)/review");

		expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", { next: "/ja-JP/(tabs)/review" });
		expect(mockLinkIdentity).not.toHaveBeenCalled();
	});

	// next はあくまで optional。指定が無ければ Supabase 呼び出しは従来と同じ形になる
	it("next が無ければ undefined のまま渡す（既存の呼び出しの意味を変えない）", async () => {
		mockUser = { id: "user-1", is_anonymous: false };

		await pressGoogle(undefined);

		expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", { next: undefined });
	});
});
