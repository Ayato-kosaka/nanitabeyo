/*
#1375 クラッシュレポート SDK の «縮退» を固定する。

⚠️ ここが落ちたら、**SDK が無いビルドでアプリが落ちる**状態になっている。
この層は «あれば原因が分かる / 無くても壊れない» が絶対条件である。

#1641 Sentry から Firebase Crashlytics へ差し替えた。DSN のような «設定しないと
動かない» 段が無くなったので、«未設定なら何もしない» のテストは
«モジュールが無ければ何もしない» に置き換わっている。
*/
import { installCrashSdk, resetCrashSdkForTest } from "./crashSdk";

// `mock` 始まりの変数名だけが jest.mock の工場から参照できる（jest の制約）
const mockInstance = { __tag: "crashlytics" };
const mockGetCrashlytics = jest.fn(() => mockInstance);
const mockSetEnabled = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockSetAttributes = jest.fn((..._args: unknown[]) => Promise.resolve());
let mockAvailable = true;

jest.mock("@react-native-firebase/crashlytics", () => {
	if (!mockAvailable) throw new Error("module not found");
	return {
		getCrashlytics: () => mockGetCrashlytics(),
		setCrashlyticsCollectionEnabled: (...args: unknown[]) => mockSetEnabled(...args),
		setAttributes: (...args: unknown[]) => mockSetAttributes(...args),
	};
});

beforeEach(() => {
	mockAvailable = true;
	mockGetCrashlytics.mockClear();
	mockSetEnabled.mockClear();
	mockSetAttributes.mockClear();
	resetCrashSdkForTest();
});

it("モジュールが無いビルドでは何もしない（縮退の唯一の入口）", () => {
	mockAvailable = false;
	expect(installCrashSdk()).toBe(false);
	expect(mockSetEnabled).not.toHaveBeenCalled();
});

it("収集を明示的に有効にし、どのビルドかを一緒に送る", () => {
	expect(installCrashSdk()).toBe(true);
	// firebase.json の設定を消しても黙って止まらないよう、コード側でも立てる
	expect(mockSetEnabled).toHaveBeenCalledWith(mockInstance, true);
	const attributes = mockSetAttributes.mock.calls[0][1] as unknown as Record<string, string>;
	// OTA で JS だけ差し替わるので、アプリのバージョンだけでは «どのコードか» が決まらない
	expect(attributes).toHaveProperty("commit_id");
	expect(attributes).toHaveProperty("app_version");
});

it("二度目は初期化しない", () => {
	expect(installCrashSdk()).toBe(true);
	expect(installCrashSdk()).toBe(false);
	expect(mockSetEnabled).toHaveBeenCalledTimes(1);
});
