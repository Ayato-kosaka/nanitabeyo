/*
#1505 GRP-01 自分が主催した投票の一覧

ライト / ダークの 2 セットで撮る。**目印の testID が実在することを確かめてから撮る**ので、
「画面は開いたが目的の UI が無い」状態の絵を掴まされない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TARGET = "me-dish-category-group-votes-header";
const ROW = "me-dish-category-group-votes-item";

/*
一覧が «空» の絵だけでは #1505 の受け入れ条件（主催した投票が並ぶ）を満たさないので、
主催セッションを 3 件返して行が描画された状態を撮る。

封筒の形（`{ data, nextCursor }`）は必ず守る。素の配列を返すと `response.data` が
undefined になり、次のレンダーの map が throw して画面ごと落ちる（実測。b225bc8c で防御済み）。

サムネイルは実 URL を叩かせず、この mock が単色 PNG を返す。既定のフォールバックは
どんな URL にも JSON を返すため、そのままだと img が壊れた絵になる。

⚠️ 中身は作り物である。映っているのは «一覧の組版» であって実データではない。
*/
const PX = {
	a: "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QQQ0AIBDAsNOJJYwiAwd82aPJBCyds5cezfeDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQD+7Br7XwW/TIlkAAAAASUVORK5CYII=",
	b: "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAo0lEQVR4nO3QMQ0AMAzAsOEuosEcg73NYSkAIp+5o09n/SAeIECAAAEKBwgQIECAwgECBAgQoHCAAAECBCgcIECAAAEKBwgQIECAwgECBAgQoHCAAAECBCgcIECAAAEKBwgQIECAwgECBAgQoHCAAAECBCgcIECAAAEKBwgQIECAwgECBAgQoHCAAAECBCgcIECAAAEKBwgQIECAwgECBAjQZg9re/NYBKxuSAAAAABJRU5ErkJggg==",
	c: "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QQQ0AIBDAsNOPBRThCgd82aPJBCydtY8ezfeDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQD+7rdZ8DIjUkXQAAAAASUVORK5CYII=",
};

const thumb = (k) => `https://example.invalid/thumb-${k}.png`;

const SESSIONS = [
	{
		id: "s-1",
		shareToken: "tok-1",
		hasVoted: true,
		candidateCount: 4,
		candidatePreviews: [
			{ displayName: "ラーメン", imageUrl: thumb("a") },
			{ displayName: "寿司", imageUrl: thumb("b") },
			{ displayName: "焼き鳥", imageUrl: thumb("c") },
		],
		participantCount: 5,
		winnerName: "ラーメン",
		createdAt: "2026-08-20T12:00:00.000Z",
		updatedAt: "2026-08-20T12:40:00.000Z",
	},
	{
		id: "s-2",
		shareToken: "tok-2",
		hasVoted: false,
		candidateCount: 3,
		candidatePreviews: [
			{ displayName: "カレー", imageUrl: thumb("b") },
			{ displayName: "パスタ", imageUrl: thumb("c") },
			{ displayName: "餃子", imageUrl: thumb("a") },
		],
		participantCount: 2,
		winnerName: null,
		createdAt: "2026-08-22T09:15:00.000Z",
		updatedAt: "2026-08-22T09:20:00.000Z",
	},
	{
		id: "s-3",
		shareToken: "tok-3",
		hasVoted: false,
		candidateCount: 2,
		candidatePreviews: [
			{ displayName: "天ぷら", imageUrl: thumb("c") },
			{ displayName: "うどん", imageUrl: thumb("a") },
		],
		participantCount: 0,
		winnerName: null,
		createdAt: "2026-08-23T18:05:00.000Z",
		updatedAt: "2026-08-23T18:05:00.000Z",
	},
];

const mock = (url) => {
	const m = url.match(/thumb-([abc])\.png/);
	if (m) return { body: Buffer.from(PX[m[1]], "base64"), contentType: "image/png" };
	if (url.includes("/v1/users/me/dish-category-group-votes"))
		return { body: ok({ data: SESSIONS, nextCursor: null }) };
	return null;
};

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

			// 「一覧が並んだ絵」を撮りに来ているので、行が実在しないなら撮らずに落とす。
			// 空状態のスクショを «一覧の証拠» として納品する事故を防ぐ。
			const rows = page.getByTestId(ROW);
			await rows.first().waitFor({ state: "visible", timeout: 15000 });
			const rowCount = await rows.count();
			if (rowCount !== SESSIONS.length) {
				throw new Error(`行が ${rowCount} 件しか描画されていない（期待 ${SESSIONS.length} 件）`);
			}
			console.log(`[${scheme}] 一覧の行 ${rowCount} 件を確認`);
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
