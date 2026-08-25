/*
#1375 クラッシュレポート SDK の «縮退» を固定する。

⚠️ ここが落ちたら、**SDK が無いビルドや DSN 未設定の環境でアプリが落ちる**状態になっている。
この層は «あれば原因が分かる / 無くても壊れない» が絶対条件である。
*/
import { installCrashSdk, resetCrashSdkForTest } from "./crashSdk";

// `mock` 始まりの変数名だけが jest.mock の工場から参照できる（jest の制約）
const mockInit = jest.fn();
jest.mock("@sentry/react-native", () => ({ init: (...args: unknown[]) => mockInit(...args) }));

beforeEach(() => {
	mockInit.mockClear();
	resetCrashSdkForTest();
	delete process.env.EXPO_PUBLIC_SENTRY_DSN;
});

it("DSN が無ければ初期化しない（キーをコードに埋めない・未設定環境で例外を出さない）", () => {
	expect(installCrashSdk()).toBe(false);
	expect(mockInit).not.toHaveBeenCalled();
});

it("DSN があれば初期化し、どのビルドかを一緒に送る", () => {
	process.env.EXPO_PUBLIC_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
	expect(installCrashSdk()).toBe(true);
	expect(mockInit).toHaveBeenCalledTimes(1);
	const options = mockInit.mock.calls[0][0] as Record<string, unknown>;
	expect(options.dsn).toBe("https://example@o0.ingest.sentry.io/0");
	// OTA で JS だけ差し替わるので、アプリのバージョンだけでは «どのコードか» が決まらない
	expect(options).toHaveProperty("dist");
	// 性能計測は入れない（送信量と端末負荷を増やさない）
	expect(options.enableAutoPerformanceTracing).toBe(false);
	expect(options.sendDefaultPii).toBe(false);
});

it("二度目は初期化しない", () => {
	process.env.EXPO_PUBLIC_SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
	expect(installCrashSdk()).toBe(true);
	expect(installCrashSdk()).toBe(false);
	expect(mockInit).toHaveBeenCalledTimes(1);
});
