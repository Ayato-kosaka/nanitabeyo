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

/*
#1641 ⚠️ **`virtual: true` を付けないこと。** ここが CI でだけ落ち続けた真因である
（run 33309359988 / 33309673017 / 33309886120 / 33310433023。同じ commit でも
落ちたり通ったりする）。

`virtual: true` は「実体が無いモジュール」を装うための指定で、jest はモックを
**実体の解決先パスではなく仮想キー**で登録する。すると `crashSdk.ts` の中から
出た require がこのモックに当たらないことがあり、そのとき**本物**が読まれる。
本物は jest 上で

    Error: Native module RNFBAppModule not found.

を投げるので、`loadCrashlytics()` の catch が null を返し、
`installCrashSdk()` が false になる ＝ このファイルの 2 件が落ちる。

この指定は `@react-native-firebase/crashlytics` を iOS のビルドエラーで
**一時的に外していた頃の名残**で、今は依存に入っている（package.json / pnpm-lock）。
実体があるなら付けてはいけない。

なお `crashSdk.absent.test.ts` がこの問題を踏まなかったのは、あちらは
「モックが当たっても当たらなくても throw する」＝どちらでも false になるためである。
「在る」側だけが、モックが本当に当たっていることに依存する。
*/
jest.mock("@react-native-firebase/crashlytics", () => ({
	getCrashlytics: () => mockGetCrashlytics(),
	setCrashlyticsCollectionEnabled: (...args: unknown[]) => mockSetEnabled(...args),
	setAttributes: (...args: unknown[]) => mockSetAttributes(...args),
}));

beforeEach(() => {
	mockGetCrashlytics.mockClear();
	mockSetEnabled.mockClear();
	mockSetAttributes.mockClear();
	resetCrashSdkForTest();
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
