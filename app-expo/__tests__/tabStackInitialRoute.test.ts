import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
#1629 【修正】オーナー実機報告「端末設定の言語を変えると戻るボタンが効かなくなる」。

> 日本語から英語に変えると英語の端末設定画面になるんですけど、そこで戻るボタンを
> 押すと検索画面に飛ぶんですよ。もう一回プロフィール行くと言語を選択する画面に入って、
> そこから戻るボタンを押すと探すタブに行っちゃうので、**もうプロフィールには
> 二度と戻れない**っていうバグが発生してます。

言語切替は `router.replace("/en-US/profile/language")` で **ロケールごとナビゲートし直す**。
このとき新しいロケールの Stack は «その 1 画面» だけで組まれるので、戻る先が Stack の中に無い。
戻るはタブナビゲータの初期タブ（＝検索）へ抜け、プロフィールへ帰る道が消える。

`unstable_settings.initialRouteName` を宣言してあると、深い URL へ直接着地したときに
**index が下に積まれた状態**で Stack が組まれるため、戻るが index へ帰る。

search には元から在り、profile / my-dishes / notifications には無かった。
**同じ穴が次のタブでも開かないように**、ここで «全タブの Stack が宣言していること» を固定する。

⚠️ これは «宣言があること» しか見ない。実際の戻り先は expo-router の実装に依るので、
   挙動そのものは実機で確認すること（この巡回でオーナーが踏んだのはまさにそれである）。
*/

const TABS_DIR = join(__dirname, "..", "app", "[locale]", "(tabs)");

/** `(tabs)` 直下で `_layout.tsx` を持つディレクトリ = 1 タブぶんの Stack */
function tabStackLayouts(): string[] {
	return readdirSync(TABS_DIR)
		.filter((name) => {
			const path = join(TABS_DIR, name);
			if (!statSync(path).isDirectory()) return false;
			try {
				return statSync(join(path, "_layout.tsx")).isFile();
			} catch {
				return false;
			}
		})
		.map((name) => join(name, "_layout.tsx"));
}

describe("#1629 タブの Stack は初期ルートを宣言している（言語切替で戻れなくなるのを防ぐ）", () => {
	it("検査対象のタブが 1 つ以上見つかる（走査が空振りしていないこと）", () => {
		expect(tabStackLayouts().length).toBeGreaterThan(0);
	});

	it("すべてのタブの _layout.tsx が initialRouteName を宣言している", () => {
		const offenders: string[] = [];
		for (const relative of tabStackLayouts()) {
			const source = readFileSync(join(TABS_DIR, relative), "utf-8");
			const hasSettings = /export const unstable_settings\s*=/.test(source);
			const hasInitial = /initialRouteName:\s*"index"/.test(source);
			if (!hasSettings || !hasInitial) offenders.push(relative);
		}
		expect(offenders).toEqual([]);
	});
});
