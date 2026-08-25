/*
#1510 SET-02 通知のカテゴリ別オン/オフ

ライト / ダークの 2 セットで撮る。**目印の testID が実在することを確かめてから撮る**ので、
「画面は開いたが目的の UI が無い」状態の絵を掴まされない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TARGET = "settings-notifications-card";

/*
モックを書かずにハーネス既定（どんな URL にも `ok([])`）へ任せると、
`useNotificationPreferences` が `response.data` を舐められず catch に落ち、
カードが «エラーが発生しました / 再試行» の状態で描画される（run 32750173211 で実測）。

`NotificationSettingsCard` は取得に失敗したらトグルを描かない仕様である
（既定値を描くと「オフにしているのにオンと表示する」嘘になるため）。
つまりモックを省くと、撮れるのはエラー状態であってこの機能の絵ではない。

カテゴリと並び順は `NOTIFICATION_CATEGORIES`（likes / saves / group_votes）が正。
オン・オフが混ざった状態にして、両方の見た目が 1 枚に入るようにしてある。
*/
const PREFERENCES = {
	data: [
		{ category: "likes", enabled: true },
		{ category: "saves", enabled: true },
		{ category: "group_votes", enabled: false },
	],
};

const mock = (url) =>
	url.includes("/v1/users/me/notification-preferences") ? { body: ok(PREFERENCES) } : null;

async function shootScheme(scheme) {
	return record({
		name: `notifprefs1510-${scheme}`,
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

			await page.goto(`${BASE}/ja-JP/profile/settings`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3500);
			await shot("01-screen");

			// 「トグルが並んだ絵」を撮りに来ているので、無いなら撮らずに落とす。
			// エラー状態のスクショを «カテゴリ別オン/オフの証拠» として納品する事故を防ぐ。
			for (const { category } of PREFERENCES.data) {
				const row = page.getByTestId(`settings-notifications-${category}`);
				await row.waitFor({ state: "visible", timeout: 15000 });
			}
			// エラー状態が出ていたら «撮れた» ことにしない
			if (await page.getByTestId("settings-notifications-error").count()) {
				throw new Error("通知カードがエラー状態で描画されている（モックが効いていない）");
			}
			console.log(`[${scheme}] トグル ${PREFERENCES.data.length} 件を確認`);

			const target = page.getByTestId(TARGET);
			await target.waitFor({ state: "attached", timeout: 15000 });
			await target.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(700);
			await shot("02-target");

			await target.screenshot({ path: `${OUT}/notifprefs1510-${scheme}-03-closeup.png` });
			console.log(`[${scheme}] ${TARGET} を撮った`);
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("notifprefs1510", [
	"# #1510 SET-02 通知のカテゴリ別オン/オフ",
	"",
	"- 01-screen … 画面を開いた直後",
	"- 02-target … 目的の UI（`settings-notifications-card`）までスクロールした状態",
	"- 03-closeup … その UI だけを切り出した拡大",
	"",
	"⚠️ 認証・API・地図はモック。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
