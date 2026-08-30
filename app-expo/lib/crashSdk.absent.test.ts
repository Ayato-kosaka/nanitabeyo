/*
#1375 / #1641 **クラッシュレポート SDK が «無い» ビルドで何もしないことだけを固定する。**

⚠️ ここが false でなくなったら、SDK が無いビルドでアプリが落ちる状態になっている。

**なぜ «在る» と別ファイルなのか。**
`jest.mock` の工場は最初の require で 1 度だけ走る。同じファイルの中でフラグを
切り替えて «在る / 無い» の両方を作る形は、どちらが先に走るかに結果が依存しうる。
テストファイルが変わればモジュールレジストリも分かれるので、こう分けておけば
順序を考えなくてよい。

⚠️ **`virtual: true` を付けないこと**（真因は `crashSdk.test.ts` の注記）。
このファイルだけは付けても落ちなかったが、それは «モックが当たっても当たらなくても
require が throw する» ＝ どちらでも false になるからで、正しかったからではない。
*/
import { installCrashSdk } from "./crashSdk";

// 本番で実際に起きる形（依存が入っていないビルド）＝ require が投げる
jest.mock("@react-native-firebase/crashlytics", () => {
	throw new Error("module not found");
});

it("使えるモジュールが無いビルドでは何もしない（縮退の唯一の入口）", () => {
	expect(installCrashSdk()).toBe(false);
});
