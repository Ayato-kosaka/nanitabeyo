/*
#1505 GRP-01 自分が主催した投票の一覧

ライト / ダークの 2 セットで撮る。**目印の testID が実在することを確かめてから撮る**ので、
「画面は開いたが目的の UI が無い」状態の絵を掴まされない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TARGET = "me-dish-category-group-votes-header";

/*
既定のモックは «空の配列» を返すが、この画面が期待しているのは
`{ data, nextCursor }` の封筒である。素の配列を返すと `response.data` が
undefined になり、次のレンダーの map が throw して画面ごと落ちる（実測）。
封筒を正しく返して «一覧が空» の状態を撮る。
*/
const mock = (url) =>
	url.includes("/v1/users/me/dish-category-group-votes")
		? { body: ok({ data: [], nextCursor: null }) }
		: null;

async function shootScheme(scheme) {
	return record({
		name: `votelist1505-${scheme}`,
		mock,
		contextOptions: { colorScheme: scheme },
		flow: async (page, shot) => {
			await page.addInitScript((s) => {
				try { window.localStorage.setItem("theme_preference_v1", s); } catch {}
				for (const k of [
					"search_tutorial_seen_v1",
					"topics_spotlight_tutorial_seen_v1",
					"my_dishes_spotlight_tutorial_seen_v1",
				]) {
					try { window.localStorage.setItem(k, "true"); } catch {}
				}
			}, scheme);

			await page.goto(`${BASE}/ja-JP/profile/dish-category-group-votes`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3500);
			await shot("01-screen");

			const target = page.getByTestId(TARGET);
			await target.waitFor({ state: "attached", timeout: 15000 });
			await target.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(700);
			await shot("02-target");

			await target.screenshot({ path: `${OUT}/votelist1505-${scheme}-03-closeup.png` });
			console.log(`[${scheme}] ${TARGET} を撮った`);
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("votelist1505", [
	"# #1505 GRP-01 自分が主催した投票の一覧",
	"",
	"- 01-screen … 画面を開いた直後",
	"- 02-target … 目的の UI（`me-dish-category-group-votes-header`）までスクロールした状態",
	"- 03-closeup … その UI だけを切り出した拡大",
	"",
	"⚠️ 認証・API・地図はモック。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
