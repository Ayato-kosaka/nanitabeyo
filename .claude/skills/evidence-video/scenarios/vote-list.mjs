// #1505 / PR #1525 自分の投票一覧（作成した / 参加した）のエビデンス。
// 設定画面の導線から入る（直リンクは SPA ビルドで戻されることがあるため）。
import { BASE, ok, record, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "grp01-vote-list";
const EMPTY = process.env.EVIDENCE_EMPTY === "1";

const ITEMS = [
	{ id: "v-1", shareToken: "tok-1", isHost: true, hasVoted: true, candidateCount: 4, createdAt: "2026-08-20T12:00:00Z", updatedAt: "2026-08-20T12:30:00Z" },
	{ id: "v-2", shareToken: "tok-2", isHost: true, hasVoted: false, candidateCount: 6, createdAt: "2026-08-18T09:00:00Z", updatedAt: "2026-08-18T09:10:00Z" },
	{ id: "v-3", shareToken: "tok-3", isHost: false, hasVoted: true, candidateCount: 3, createdAt: "2026-08-15T19:00:00Z", updatedAt: "2026-08-15T19:20:00Z" },
	{ id: "v-4", shareToken: "tok-4", isHost: false, hasVoted: false, candidateCount: 5, createdAt: "2026-08-10T18:00:00Z", updatedAt: "2026-08-10T18:05:00Z" },
];

const notes = [];
let listCalls = 0;

await record({
	name: NAME,
	langs: ["ja"],
	mock: async (url) => {
		if (url.includes("users/me/dish-category-group-votes")) {
			listCalls += 1;
			const data = EMPTY ? [] : ITEMS;
			console.log(`投票一覧API #${listCalls} → ${data.length} 件`);
			return { body: ok({ data, nextCursor: null }) };
		}
		return null;
	},
	flow: async (page, shot) => {
		await page.goto(`${BASE}/ja-JP/profile/settings`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(8000);
		await shot("01-settings");

		const entry = page.getByTestId("settings-my-group-votes");
		const n = await entry.count();
		notes.push(`1. 設定画面の「自分の投票」導線: ${n} 件`);
		if (!n) {
			notes.push("⚠️ 導線が見つからず、一覧へ到達できていない。");
			return;
		}
		await entry.scrollIntoViewIfNeeded();
		await entry.click();
		await page.waitForTimeout(5000);
		await shot("02-list");

		const header = await page.getByTestId("me-dish-category-group-votes-header").count();
		const empty = await page.getByTestId("me-dish-category-group-votes-empty-state").count();
		notes.push(`2. 一覧画面: ヘッダー=${header} / 空状態=${empty} / URL=${page.url().replace(/^https?:\/\/[^/]+/, "")}`);
		notes.push(`   API が返した件数: ${EMPTY ? 0 : ITEMS.length}`);

		if (!EMPTY) {
			// 画面の実際の文言で数える。
			// ⚠️ 最初 "ホスト"/"参加" で数えて 0 件になった。UI の文言は
			//    「主催」「投票済み」「未投票」で、推測した語ではなかった。
			for (const [label, want] of [["主催", 2], ["投票済み", 2], ["未投票", 2]]) {
				const c = await page.getByText(label, { exact: false }).count();
				notes.push(`   "${label}" の表示数: ${c}（モックの期待: ${want}）`);
			}
			await page.mouse.move(195, 500);
			for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(400); }
			await page.waitForTimeout(800);
			await shot("03-scrolled");
		}
	},
});

await writeNote(NAME, notes);
console.log(notes.join("\n"));
