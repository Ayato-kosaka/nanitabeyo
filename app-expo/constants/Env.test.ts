// #1495 設定画面のバージョン表示（VersionInfo）が拠り所にする Env.RUNTIME_VERSION の契約を守る。
//
// jest.setup.js のグローバル mock（#1087）は Constants.expoConfig を空に近い状態にする
// （jest-expo は app.config.ts を評価しないため runtimeVersion は乗らない）。
// この状態は「ビルド成果物から runtimeVersion が取れないプラットフォーム／環境」の実例そのものなので、
// ここを追加でモックし直さず**そのまま**使う。ここで undefined が漏れると
// components/VersionInfo.tsx が i18n の `[missing "{{runtimeVersion}}" value]` を出してしまう
// （#1495 の要件「取れないプラットフォームがあっても空白/undefined を表示しない」に違反する）。
import { Env } from "@/constants/Env";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";

describe("#1495 Env.RUNTIME_VERSION", () => {
	it("expo-constants に runtimeVersion が乗っていない環境でも undefined にならず、既定値へ落ちる", () => {
		expect(Env.RUNTIME_VERSION).toBe(UNKNOWN_BUILD_META_CLIENT);
	});

	it("常に空でない文字列を返す（表示時に空白行にならない）", () => {
		expect(typeof Env.RUNTIME_VERSION).toBe("string");
		expect(Env.RUNTIME_VERSION.length).toBeGreaterThan(0);
	});
});

describe("#1495 Env.COMMIT_ID（VersionInfo が OTA 更新の特定に使う値）", () => {
	it("EXPO_PUBLIC_COMMIT_ID が注入されていない環境でも常に空でない文字列を返す", () => {
		expect(typeof Env.COMMIT_ID).toBe("string");
		expect(Env.COMMIT_ID.length).toBeGreaterThan(0);
	});
});
