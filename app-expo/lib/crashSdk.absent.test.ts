/*
#1375 / #1641 **クラッシュレポート SDK が «無い» ビルドで何もしないことだけを固定する。**

⚠️ **なぜ別ファイルなのか。**
`jest.mock` の工場は **最初の require のときに 1 度だけ走り、結果（例外も）がキャッシュされる**。
同じファイルの中でフラグを切り替えて «在る / 無い» の両方を作ろうとすると、片方を実行した
後にもう片方が道連れになる（run 33309359988 / 33309... で CI だけ落ちた。getter で
形を切り替える手も CI では効かなかった）。

**テストファイルが変わればモジュールレジストリも分かれる。** «無い» はこのファイル、
«在る» は `crashSdk.test.ts` と分けるのが、順序にもキャッシュにも依存しない唯一の形である。
*/
import { installCrashSdk } from "./crashSdk";

// 本番で実際に起きる形（依存が入っていないビルド）＝ require が投げる
jest.mock(
	"@react-native-firebase/crashlytics",
	() => {
		throw new Error("module not found");
	},
	{ virtual: true },
);

it("使えるモジュールが無いビルドでは何もしない（縮退の唯一の入口）", () => {
	// ここが false でなくなったら、SDK が無いビルドでアプリが落ちる状態になっている
	expect(installCrashSdk()).toBe(false);
});
