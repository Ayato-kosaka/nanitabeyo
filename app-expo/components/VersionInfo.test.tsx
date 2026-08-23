// #1495 設定画面のバージョン表示。
//
// 監査 #1042 SUP-03 の要件は「サポート問い合わせでどのビルドを使っているか特定できること」。
// バージョン番号だけでは同一バージョン内の OTA 更新（EAS Update）を区別できないため、
// runtimeVersion / commitId も併記している。このテストは以下を赤で守る。
//   1. Env.APP_VERSION がそのまま表示される
//   2. runtimeVersion / commitId が取得できるプラットフォームでは両方とも表示される
//   3. selectable にして問い合わせ時にコピーできる
//
// 「値が取得できないプラットフォームでも undefined や空白を出さない」保証は、
// この画面ではなく Env 側の責務（RUNTIME_VERSION / COMMIT_ID は欠損時に
// UNKNOWN_BUILD_META_CLIENT へ落ちる）として constants/Env.test.ts で固定している。
// ここで同じ前提を undefined を注入して再検証すると、Env が保証しない状態を
// この画面側で偽装することになり、Env の契約が壊れた場合にこのテストが
// 検知しないまま緑になる（本来落ちるべき場所で落ちない）ため、あえて重複させない。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text } from "react-native";

let mockEnv: { APP_VERSION: string; RUNTIME_VERSION: string; COMMIT_ID: string };
jest.mock("@/constants/Env", () => ({
	get Env() {
		return mockEnv;
	},
}));

import { VersionInfo } from "./VersionInfo";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
// (components/FeedbackForm.test.tsx と同じ理由)
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: TestRenderer.ReactTestRenderer;

const render = () => {
	act(() => {
		renderer = TestRenderer.create(React.createElement(VersionInfo));
	});
	return renderer;
};

const allText = (renderer: TestRenderer.ReactTestRenderer) =>
	renderer.root
		.findAllByType(Text)
		.map((node) => node.props.children)
		.flat()
		.join(" ");

describe("#1495 VersionInfo", () => {
	it("Env.APP_VERSION の値をそのまま表示する", () => {
		mockEnv = { APP_VERSION: "1.14.0", RUNTIME_VERSION: "1.14", COMMIT_ID: "abc123" };

		const renderer = render();

		expect(allText(renderer)).toContain("1.14.0");
	});

	it("runtimeVersion と commitId を併記する（OTA 更新の特定に必要）", () => {
		mockEnv = { APP_VERSION: "1.14.0", RUNTIME_VERSION: "1.14", COMMIT_ID: "abc123def456" };

		const renderer = render();
		const text = allText(renderer);

		expect(text).toContain("1.14");
		expect(text).toContain("abc123def456");
	});

	it("バージョンとビルド情報を web/native 共通でコピーできるよう selectable にする", () => {
		mockEnv = { APP_VERSION: "1.14.0", RUNTIME_VERSION: "1.14", COMMIT_ID: "abc123" };

		const renderer = render();
		const texts = renderer.root.findAllByType(Text);

		expect(texts.length).toBeGreaterThan(0);
		texts.forEach((node) => expect(node.props.selectable).toBe(true));
	});
});
