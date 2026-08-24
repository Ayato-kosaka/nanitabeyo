// #1502 / PR #1524 検索地点の「確認中 / 確定 / 失敗」を撮る。
// v1/locations/autocomplete で候補を返し、v1/locations/details を
// 遅延（確認中を映すため）または 500（失敗を映すため）にする。
import { BASE, ok, record, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "sea01-location-state";
const FAIL = process.env.EVIDENCE_FAIL === "1";
const DETAILS_DELAY_MS = Number(process.env.EVIDENCE_DETAILS_DELAY ?? 4000);

const PREDICTIONS = [
	{ placeId: "place-shibuya", description: "東京都 渋谷区", mainText: "渋谷区", secondaryText: "東京都" },
	{ placeId: "place-shinjuku", description: "東京都 新宿区", mainText: "新宿区", secondaryText: "東京都" },
];
const DETAILS = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	localLanguageCode: "ja",
};

const notes = [];
let detailsCalls = 0;

await record({
	name: NAME,
	langs: ["ja"],
	mock: async (url) => {
		if (url.includes("v1/locations/autocomplete")) return { body: ok(PREDICTIONS) };
		if (url.includes("v1/locations/details")) {
			detailsCalls += 1;
			// 「確認しています…」が映る時間を作るために、わざと遅らせる
			await new Promise((r) => setTimeout(r, DETAILS_DELAY_MS));
			if (FAIL) {
				console.log(`地点詳細 #${detailsCalls} → 500`);
				return { status: 500, body: JSON.stringify({ success: false }) };
			}
			console.log(`地点詳細 #${detailsCalls} → 200`);
			return { body: ok(DETAILS) };
		}
		return null; // harness の既定に任せる
	},
	flow: async (page, shot) => {
		await page.goto(`${BASE}/ja-JP/search`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(9000);
		await shot("01-search");

		const input = page.getByTestId("search-location-autocomplete-input");
		if (!(await input.count())) {
			notes.push("⚠️ 地点入力欄が見つからなかった。以降は撮れていない。");
			return;
		}
		await input.click();
		await input.fill("渋谷");
		await page.waitForTimeout(2500);
		await shot("02-suggestions");
		const sugg = page.getByTestId("search-location-autocomplete-suggestion-0");
		const sn = await sugg.count();
		notes.push(`1. 「渋谷」と入力したときの候補の数: ${sn}`);
		if (!sn) {
			notes.push("⚠️ 候補が出ず、以降の状態遷移を撮れていない。");
			return;
		}

		await sugg.click();
		// 「確認しています…」を捉える（details を遅らせてある）
		await page.waitForTimeout(1200);
		await shot("03-confirming");
		const confirming = await page.getByTestId("search-location-autocomplete-confirmation-confirming").count();
		const confirmingText = confirming ? (await page.getByText("地点を確認しています…").count()) : 0;
		notes.push(`2. 選択直後の「確認中」表示: testID=${confirming} / 文言一致=${confirmingText}`);

		// 決着まで待つ
		await page.waitForTimeout(DETAILS_DELAY_MS + 3000);
		await shot("04-settled");
		const confirmed = await page.getByTestId("search-location-autocomplete-confirmation-confirmed").count();
		const errored = await page.getByTestId("search-location-autocomplete-confirmation-error").count();
		const retry = await page.getByTestId("search-location-autocomplete-confirmation-retry").count();
		notes.push(`3. 決着後: 確定=${confirmed} / 失敗=${errored} / 再試行ボタン=${retry}`);
		notes.push(`   （このrunは ${FAIL ? "詳細APIを500にした失敗系" : "詳細APIを200にした成功系"}）`);
	},
});

await writeNote(NAME, notes);
console.log(notes.join("\n"));
