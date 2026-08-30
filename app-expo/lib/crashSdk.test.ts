/*
#1375 クラッシュレポート SDK の «縮退» を固定する。

⚠️ ここが落ちたら、**SDK が無いビルドでアプリが落ちる**状態になっている。
この層は «あれば原因が分かる / 無くても壊れない» が絶対条件である。

#1641 Sentry から Firebase Crashlytics へ差し替えた。DSN のような «設定しないと
動かない» 段が無くなったので、«未設定なら何もしない» のテストは
«モジュールが無ければ何もしない» に置き換わっている。
*/
import { Platform } from "react-native";
import { installCrashSdk, loadCrashlytics, resetCrashSdkForTest } from "./crashSdk";

// `mock` 始まりの変数名だけが jest.mock の工場から参照できる（jest の制約）
const mockInstance = { __tag: "crashlytics" };
const mockGetCrashlytics = jest.fn(() => mockInstance);
const mockSetEnabled = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockSetAttributes = jest.fn((..._args: unknown[]) => Promise.resolve());

/*
#1641 ⚠️ **このファイルは «モジュールが在る» 側だけを見る。**

«無い» 側は `crashSdk.absent.test.ts` に分けてある。`jest.mock` の工場は最初の require で
1 度だけ走り結果がキャッシュされるので、**1 つのファイルで «在る / 無い» を切り替えられない**
（フラグ + throw も、getter で形を変える手も CI で落ちた。run 33309359988）。
テストファイルが変わればモジュールレジストリも分かれる、というのが唯一効く分け方である。
*/
jest.mock(
	"@react-native-firebase/crashlytics",
	() => ({
		getCrashlytics: () => mockGetCrashlytics(),
		setCrashlyticsCollectionEnabled: (...args: unknown[]) => mockSetEnabled(...args),
		setAttributes: (...args: unknown[]) => mockSetAttributes(...args),
	}),
	{ virtual: true },
);

beforeEach(() => {
	mockGetCrashlytics.mockClear();
	mockSetEnabled.mockClear();
	mockSetAttributes.mockClear();
	resetCrashSdkForTest();
});

// TODO(#1641) 一時的な診断。CI でだけ落ちる原因を特定したら必ず消す。
it("DIAG", () => {
	let req: string;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const m = require("@react-native-firebase/crashlytics") as Record<string, unknown> | undefined;
		req = `ok keys=[${Object.keys(m ?? {}).join("|")}] typeofGet=${typeof m?.getCrashlytics}`;
	} catch (e) {
		req = `throw ${String(e)}`;
	}
	throw new Error(
		`DIAG platform=${Platform.OS} require=${req} load=${loadCrashlytics() === null ? "null" : "mod"} install=${installCrashSdk()}`,
	);
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
