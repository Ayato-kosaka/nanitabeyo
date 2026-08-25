// #1495 設定画面のバージョン表示。
//
// 監査 #1042 SUP-03 の要件は「サポート問い合わせでどのビルドを使っているか特定できること」。
// バージョン番号だけでは同一バージョン内の OTA 更新（EAS Update）を区別できないため、
// 短縮コミット ID（先頭 7 桁）を併記している。このテストは以下を赤で守る。
//   1. "{version}({短縮コミットID})" の 1 行で表示される
//   2. EXPO_PUBLIC_COMMIT_ID が未設定（UNKNOWN_BUILD_META_CLIENT）の環境では "(dev)" を出す
//   3. selectable にして問い合わせ時にコピーできる
//
// 「値が取得できないプラットフォームでも undefined や空白を出さない」保証は、
// この画面ではなく Env 側の責務（COMMIT_ID は欠損時に UNKNOWN_BUILD_META_CLIENT へ落ちる）
// として constants/Env.test.ts で固定している。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text } from "react-native";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";

let mockEnv: { APP_VERSION: string; COMMIT_ID: string };
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
	it("バージョンと短縮コミットIDを 1 行 \"version(commitId)\" で表示する", () => {
		mockEnv = { APP_VERSION: "1.14.0", COMMIT_ID: "abc123def456" };

		const renderer = render();

		expect(allText(renderer)).toBe("1.14.0(abc123d)");
	});

	it("コミットIDが取得できない環境（未設定 = UNKNOWN_BUILD_META_CLIENT）では (dev) を出す", () => {
		mockEnv = { APP_VERSION: "1.14.0", COMMIT_ID: UNKNOWN_BUILD_META_CLIENT };

		const renderer = render();

		expect(allText(renderer)).toBe("1.14.0(dev)");
	});

	it("バージョン情報を web/native 共通でコピーできるよう selectable にする", () => {
		mockEnv = { APP_VERSION: "1.14.0", COMMIT_ID: "abc123def456" };

		const renderer = render();
		const texts = renderer.root.findAllByType(Text);

		expect(texts.length).toBeGreaterThan(0);
		texts.forEach((node) => expect(node.props.selectable).toBe(true));
	});
});
