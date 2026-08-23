// #1469 の新画面がダークモードに追従しているかを、明/暗の同一画面で見比べる。
// 判定は目視だが、比較しやすいよう明→暗を同じファイル名規則で並べて出す。
import { record, writeNote, OUT } from "./harness.mjs";

const ROUTES = [
	["my-dishes",         "/ja-JP/my-dishes"],
	["my-dishes-filters", "/ja-JP/my-dishes/filters"],
	["sns-import",        "/ja-JP/sns-import"],
	["profile",           "/ja-JP/profile"],
	// 比較対象（テーマ対応済みと分かっている画面）
	["search",            "/ja-JP/search"],
];

const mock = () => null;

async function shootScheme(scheme) {
	return record({
		name: `dark1469-${scheme}`,
		mock,
		contextOptions: { colorScheme: scheme },
		flow: async (page, shot) => {
			// AsyncStorage(web は localStorage) の設定値も明示的に合わせる。
			// 既定は "system" なので colorScheme だけでも効くはずだが、
			// 「システム追従が効いていないから暗くならない」と
			// 「実装が色を直書きしているから暗くならない」を切り分けるために両方立てる。
			await page.addInitScript((s) => {
				try { window.localStorage.setItem("theme_preference_v1", s); } catch {}
			}, scheme);

			for (const [label, path] of ROUTES) {
				await page.goto(`http://localhost:8788${path}`, { waitUntil: "domcontentloaded" });
				await page.waitForTimeout(2500);
				await shot(label);
			}
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("dark1469", [
	"# #1469 ダークモード追従の確認",
	"",
	"同じルートを colorScheme=light / dark で撮ったもの。",
	"暗い方が明るい方と同じ見た目なら、その画面はテーマに追従していない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
