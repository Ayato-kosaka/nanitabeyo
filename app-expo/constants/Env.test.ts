// #1495 設定画面のバージョン表示（VersionInfo）が拠り所にする Env.COMMIT_ID の契約を守る。
//
// jest.setup.js のグローバル mock（#1087）は Constants.expoConfig を空に近い状態にする。
// この状態は「ビルド成果物から COMMIT_ID が取れないプラットフォーム／環境」の実例そのものなので、
// ここを追加でモックし直さず**そのまま**使う。ここで undefined が漏れると
// components/VersionInfo.tsx が "undefined" をそのまま表示してしまう
// （#1495 の要件「取れないプラットフォームがあっても空白/undefined を表示しない」に違反する）。
import { Env } from "@/constants/Env";

describe("#1495 Env.COMMIT_ID（VersionInfo が OTA 更新の特定に使う値）", () => {
	it("EXPO_PUBLIC_COMMIT_ID が注入されていない環境でも常に空でない文字列を返す", () => {
		expect(typeof Env.COMMIT_ID).toBe("string");
		expect(Env.COMMIT_ID.length).toBeGreaterThan(0);
	});
});
