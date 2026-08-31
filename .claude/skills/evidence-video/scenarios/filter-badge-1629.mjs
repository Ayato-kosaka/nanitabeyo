/*
#1629 オーナー指示「フィルタボタンの件数バッジ →やる。**件数表示は不要**」。

## 何を撮るか

「食べたい/食べた」タブの右上、絞り込みボタンの印。

- 絞り込み **なし** … 印は出ない
- 絞り込み **あり** … 数字ではなく **点** が付く（変更前は「1」「2」と数字が出ていた）

⚠️ 認証・API はモック。映っているのは «画面の見た目» であって実データではない。
   記録が 0 件でも、絞り込みの適用そのものと印の有無は同じように見える。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const NAME = process.env.EVIDENCE_NAME || "filter-badge-1629";

const notes = [];

const mock = (url) => {
	if (url.includes("/v1/users/me/dishes")) return { body: ok({ data: [], nextCursor: null }) };
	return null;
};

await record({
	name: NAME,
	langs: ["ja"],
	mock,
	flow: async (page, shot) => {
		await page.addInitScript(() => {
			for (const k of ["search_tutorial_seen_v1", "my_dishes_spotlight_tutorial_seen_v1"]) {
				try { window.localStorage.setItem(k, "true"); } catch {}
			}
		});

		await page.goto(`${BASE}/ja-JP/my-dishes`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(5000);
		await shot("01-no-filter");
		notes.push(
			(await page.getByTestId("my-dishes-filter-badge").count()) === 0
				? "1. ✅ 絞り込み無しでは印が出ていない"
				: "1. ❌ 絞り込み無しなのに印が出ている",
		);

		await page.getByTestId("my-dishes-filter-button").first().click();
		await page.waitForTimeout(2500);
		await shot("02-filter-screen");

		// 「食べたい」だけに絞る。どの行でもよいので、状態の選択肢を 1 つ押す
		const status = page.getByText("食べたい", { exact: true }).first();
		if (!(await status.count())) {
			notes.push("⚠️ 絞り込み画面に «食べたい» が見つからない（以降は撮れていない）");
			writeNote(NAME, notes);
			return;
		}
		await status.click();
		await page.waitForTimeout(800);

		const apply = page.getByText("適用", { exact: false }).first();
		if (await apply.count()) await apply.click();
		await page.waitForTimeout(3000);
		await shot("03-with-filter");

		const badge = page.getByTestId("my-dishes-filter-badge");
		const shown = (await badge.count()) > 0;
		notes.push(shown ? "2. ✅ 絞り込みを掛けると印が出る" : "2. ❌ 絞り込みを掛けても印が出ない");
		if (shown) {
			// **数字が入っていないこと**が今回の要点なので、中身の文字を読んで残す
			const text = (await badge.first().innerText()).trim();
			notes.push(`3. 印の中の文字: ${JSON.stringify(text)}（空なら «件数を出していない» が満たされている）`);
			const box = await badge.first().boundingBox();
			notes.push(`4. 印の大きさ: ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "取得できず"}`);
		}

		writeNote(NAME, notes);
	},
});

console.log(`done -> ${OUT}`);
