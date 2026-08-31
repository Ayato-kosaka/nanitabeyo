/*
#1736 【バグ】**Android は OS の許可ダイアログが出ている間、JS のタイマーが止まる。**

権限の説明画面（components/OnboardingPermissionScreen.tsx）は、もともと
「要求を先に投げ → 400ms 以内に即答が返らなければ説明を描く」構造だった。
Android では許可ダイアログが別 Activity で、アプリは `onPause` に入り、React Native は
`onHostPause` でタイマーを止める（JavaTimerManager）。つまり **その 400ms は永久に来ない**。
ユーザーには「無地の画面の上に OS ダイアログだけ」が見え、答えた «あと» に説明が出ていた。

ここで固定するのは、ネイティブでは **要求より先に説明が描かれていること**。
タイマーが止まる Android の挙動そのものは jest では再現できないので、
«要求が返る前の時点で説明が画面に載っているか» という観測可能な形に落としている。
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { OnboardingPermissionScreen } from "./components/OnboardingPermissionScreen";
import type { PermissionOutcome, PermissionPromptState } from "./permissions";

jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView };
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/contexts/ThemeProvider", () => ({
	// パレットは色の «役割 → 値» の対応表でしかないので、テストでは何を返しても描画に影響しない
	useThemedStyles: (createStyles: (palette: any) => unknown) => createStyles(new Proxy({}, { get: () => "#000000" })),
}));

const dialogPreview = {
	title: "dialog-title",
	message: "dialog-message",
	buttons: [{ label: "deny" }, { label: "allow", emphasized: true }],
};

/** 画面上に描かれているテキストを集める */
const renderedTexts = (renderer: TestRenderer.ReactTestRenderer): string[] =>
	renderer.root
		.findAllByType(require("react-native").Text)
		.flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]))
		.filter((child): child is string => typeof child === "string");

describe("OnboardingPermissionScreen（ネイティブ）", () => {
	it("OS へ要求する前に説明が描かれている（ダイアログが無地の画面に重ならない）", async () => {
		const probe = jest.fn<Promise<PermissionPromptState>, []>().mockResolvedValue("prompt");

		// 「ダイアログが出たまま答えが返らない」= Android で Activity が止まっている状態に相当する。
		// この間に説明が描かれていなければ、実機では無地の画面の上にダイアログだけが出る
		let answer: (outcome: PermissionOutcome) => void = () => {};
		const request = jest.fn(() => new Promise<PermissionOutcome>((resolve) => (answer = resolve)));

		const onSettled = jest.fn();
		let renderer!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			renderer = TestRenderer.create(
				<OnboardingPermissionScreen
					title="permission-title"
					body="permission-body"
					progress={0.6}
					probe={probe}
					request={request}
					dialogPreview={dialogPreview}
					onSettled={onSettled}
				/>,
			);
		});

		expect(request).toHaveBeenCalledTimes(1);
		const texts = renderedTexts(renderer);
		expect(texts).toContain("permission-title");
		expect(texts).toContain("permission-body");
		// 中央のダミーダイアログ（«どれを押せばいいか» の案内）も出ていること
		expect(texts).toContain("dialog-title");

		// 答えたあとは «最低表示時間»（MINIMUM_VISIBLE_MS = 1400ms）を待ってから次へ進む。
		// 実時間で待ち切ることで、宙に浮いたタイマーを残さずに «次へ進む» ことまで検証する
		await act(async () => {
			answer("granted");
			await new Promise<void>((resolve) => setTimeout(resolve, 1600));
		});
		expect(onSettled).toHaveBeenCalledWith("granted");
		renderer.unmount();
	});

	it("回答済み（prompt でない）なら説明を描かずに次へ進む", async () => {
		const onSettled = jest.fn();
		const request = jest.fn<Promise<PermissionOutcome>, []>().mockResolvedValue("granted");

		let renderer!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			renderer = TestRenderer.create(
				<OnboardingPermissionScreen
					title="permission-title"
					body="permission-body"
					progress={0.6}
					probe={jest.fn<Promise<PermissionPromptState>, []>().mockResolvedValue("granted")}
					request={request}
					dialogPreview={dialogPreview}
					onSettled={onSettled}
				/>,
			);
		});

		expect(request).not.toHaveBeenCalled();
		expect(onSettled).toHaveBeenCalledWith("granted");
		expect(renderedTexts(renderer)).not.toContain("permission-title");
		renderer.unmount();
	});
});
