// #1469 の新画面がダークモードに追従しているかを、明/暗の同一画面で見比べる。
// 判定は目視だが、比較しやすいよう明→暗を同じファイル名規則で並べて出す。
import { record, writeNote, OUT } from "./harness.mjs";

const ROUTES = [
	["my-dishes",         "/ja-JP/my-dishes"],
	["my-dishes-filters", "/ja-JP/my-dishes/filters"],
	// #1375（5 巡目）で sns-import は add-record へ改名された（旧ルートは転送のみ）。
	// トークン化も改名先へ載せ直してあるので、撮るのは実体のある方
	["add-record",        "/ja-JP/add-record"],
	["profile",           "/ja-JP/profile"],
	// #1509 のマージで新たにトークン化した画面（#1375 が分岐後に足したもの）
	["posts-not-found",   "/ja-JP/posts"],
	["dish-category",     "/ja-JP/restaurant/r-1/dish-category"],
	["review-form",       "/ja-JP/restaurant/r-1/review"],
	["select-restaurant", "/ja-JP/my-dishes/select-restaurant"],
	// ⚠️ `profile/device-settings` はここへ足さないこと。あの画面は #1504（PR #1515）のもので、
	//    このブランチの base（#1469）にはまだ入っていない。足すと «ライトもダークも同じ»
	//    という ❌ が出るが、それはテーマ非追従ではなく «ルートが無い» の意味になる
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
