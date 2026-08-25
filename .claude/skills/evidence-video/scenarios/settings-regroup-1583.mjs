/*
#1583 マイページ（設定）の構成をゼロベースで見直した結果のエビデンス。

オーナー指摘（2026-08-25）:
  「設定画面の構成をゼロベースで見直して欲しい。例えば、
   ・なに食べよについて ・なに食べよ を応援する ・利用規約、、、 ・バージョン番号
   ライトモードダークモードも、端末設定ページにグルーピングするべきなきもする」

撮る面:
  1. 画面上部 … «自分のもの» と «通知» のまとまり
  2. 画面下部 … «端末の設定»（表示テーマがここへ移った）と «なに食べよについて»
  3. バージョン番号が «なに食べよについて» の最終行に出ていること

**撮る前に見出しと版数行の実在を確かめる。** 並び替えの絵は「それっぽく写る」ので、
目視だけだと «見出しが 1 つ抜けている» に気づけない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";

/*
通知カードは取得に失敗するとトグルを描かず «エラー / 再試行» になる（#1510）。
モックを省くとハーネス既定の `ok([])` でその状態が撮れてしまうので、明示的に返す。
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

/** 新しい構成の骨格。1 つでも欠けたら並び替えが壊れている */
const REQUIRED_HEADINGS = ["自分のもの", "端末の設定", "なに食べよについて"];

async function shootScheme(scheme) {
	return record({
		name: `settings1583-${scheme}`,
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
			await page.getByTestId("settings-scroll").waitFor({ state: "visible", timeout: 15000 });
			await page.waitForTimeout(3500);

			// ── 撮る前の検査 ──
			const bodyText = await page.locator("body").innerText();
			for (const heading of REQUIRED_HEADINGS) {
				if (!bodyText.includes(heading)) {
					throw new Error(`見出し «${heading}» が無い。#1583 の並び替えが入っていないビルドを撮ろうとしている`);
				}
			}
			// 版数行。押せない行なので testID でしか捕まえられない
			const version = page.getByTestId("settings-version");
			await version.waitFor({ state: "attached", timeout: 10000 });
			const versionText = (await version.innerText()).replace(/\s+/g, " ").trim();
			if (!/\d+\.\d+\.\d+/.test(versionText)) {
				throw new Error(`バージョン行に版数が出ていない: ${JSON.stringify(versionText)}`);
			}
			// 表示テーマが «端末の設定» より後に出ていること（＝最上段から移動できている）
			if (bodyText.indexOf("端末の設定") > bodyText.indexOf("表示テーマ")) {
				throw new Error("«表示テーマ» が «端末の設定» より前にある。テーマの移設ができていない");
			}

			await shot("01-top");

			// 下端まで送って «端末の設定» と «なに食べよについて» を映す
			await page.mouse.move(195, 500);
			for (let i = 0; i < 6; i++) {
				await page.mouse.wheel(0, 200);
				await page.waitForTimeout(350);
			}
			await page.waitForTimeout(900);
			await shot("02-device-and-about");

			for (let i = 0; i < 6; i++) {
				await page.mouse.wheel(0, 200);
				await page.waitForTimeout(350);
			}
			await page.waitForTimeout(900);
			await shot("03-bottom-version");

			// バージョン行を確実に画面内へ入れた 1 枚
			await version.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(800);
			await shot("04-version-row");

			return versionText;
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("settings1583", [
	"# #1583 設定画面の構成をゼロベースで見直す",
	"",
	"新しい並び: 自分のもの → 通知 → 端末の設定 → なに食べよについて → ログアウト",
	"",
	"- 01-top … 画面上部（自分のもの / 通知）",
	"- 02-device-and-about … 端末の設定（表示テーマがここへ移った）と なに食べよについて（**本命**）",
	"- 03-bottom-version … 下端。バージョン番号とログアウト",
	"- 04-version-row … バージョン行を画面内に入れた 1 枚（**本命**）",
	"",
	"⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
