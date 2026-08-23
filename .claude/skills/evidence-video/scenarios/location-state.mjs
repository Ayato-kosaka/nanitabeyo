// #1502 / PR #1524 検索地点の確認 UX（案A）を撮る。
//
// 案A: 成功は文章で語らない。
//   - 確認中: 入力欄右端に小さなスピナー（文言なし）
//   - 確定:   入力欄右端に ✓ が一瞬(2000ms)出て、入力欄の値が候補の正式なフル地名
//             (autocomplete の text)へ置き換わる
//   - 失敗:   赤の1行 + 再試行ボタン（エラーだけが言葉を持つ）
//
// v1/locations/autocomplete で候補を返し、v1/locations/details を
// 遅延（確認中を映すため）または 500（失敗を映すため）にする。
//
// 環境変数:
//   EVIDENCE_NAME    出力ファイルの接頭辞
//   EVIDENCE_FAIL=1  details を 500 にして失敗系を撮る
//   EVIDENCE_PRESET  default | android | ios  (harness.mjs の PRESETS)
//   EVIDENCE_LOCALE  ja-JP | ar-SA など。ar-SA は RTL でスピナー/✓ の右端配置が
//                    破綻しないかの確認用（#1502 の実装注意事項）
import { BASE, ok, record, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "sea01-location-state";
const FAIL = process.env.EVIDENCE_FAIL === "1";
const PRESET = process.env.EVIDENCE_PRESET || "default";
const LOCALE = process.env.EVIDENCE_LOCALE || "ja-JP";
const DETAILS_DELAY_MS = Number(process.env.EVIDENCE_DETAILS_DELAY ?? 4000);

const IS_AR = LOCALE.startsWith("ar");
// 入力する検索語と候補。ar のときは RTL の実文字で配置崩れを見る
const QUERY = IS_AR ? "شيبويا" : "渋谷";
const PREDICTIONS = IS_AR
	? [
			{ place_id: "place-shibuya", text: "شيبويا، طوكيو، اليابان", mainText: "شيبويا", secondaryText: "طوكيو، اليابان", types: ["locality"] },
			{ place_id: "place-shinjuku", text: "شينجوكو، طوكيو، اليابان", mainText: "شينجوكو", secondaryText: "طوكيو، اليابان", types: ["locality"] },
		]
	: [
			{ place_id: "place-shibuya", text: "渋谷区, 東京都", mainText: "渋谷区", secondaryText: "東京都", types: ["locality"] },
			{ place_id: "place-shinjuku", text: "新宿区, 東京都", mainText: "新宿区", secondaryText: "東京都", types: ["locality"] },
		];
const DETAILS = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	localLanguageCode: "ja",
	viewport: {
		low: { latitude: 35.64, longitude: 139.69 },
		high: { latitude: 35.67, longitude: 139.72 },
	},
};

const notes = [`preset=${PRESET} / locale=${LOCALE} / ${FAIL ? "失敗系(details=500)" : "成功系(details=200)"}`];
let detailsCalls = 0;

await record({
	name: NAME,
	preset: PRESET,
	langs: IS_AR ? ["ar"] : ["ja"],
	contextOptions: { locale: LOCALE },
	mock: async (url) => {
		if (url.includes("v1/locations/autocomplete")) return { body: ok(PREDICTIONS) };
		if (url.includes("v1/locations/details")) {
			detailsCalls += 1;
			// スピナー（確認中）が映る時間を作るために、わざと遅らせる
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
		await page.goto(`${BASE}/${LOCALE}/search`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(9000);
		await shot("01-search");

		const input = page.getByTestId("search-location-autocomplete-input");
		if (!(await input.count())) {
			notes.push("⚠️ 地点入力欄が見つからなかった。以降は撮れていない。");
			return;
		}
		await input.click();
		await input.fill(QUERY);
		await page.waitForTimeout(2500);
		await shot("02-suggestions");
		const sugg = page.getByTestId("search-location-autocomplete-suggestion-0");
		const sn = await sugg.count();
		notes.push(`1. 「${QUERY}」と入力したときの候補の数: ${sn}`);
		if (!sn) {
			notes.push("⚠️ 候補が出ず、以降の状態遷移を撮れていない。");
			return;
		}

		await sugg.click();
		// 確認中: 入力欄右端のスピナー（文言なし）を捉える（details を遅らせてある）
		await page.waitForTimeout(1200);
		await shot("03-confirming");
		const confirming = await page.getByTestId("search-location-autocomplete-confirmation-confirming").count();
		const valueWhileConfirming = await input.inputValue().catch(() => "(取得失敗)");
		notes.push(`2. 選択直後の確認中スピナー: testID=${confirming} / 入力値=${valueWhileConfirming}`);

		if (FAIL) {
			// 失敗が決着するまで待つ
			await page.waitForTimeout(DETAILS_DELAY_MS + 2000);
			await shot("04-error");
			const errored = await page.getByTestId("search-location-autocomplete-confirmation-error").count();
			const retry = await page.getByTestId("search-location-autocomplete-confirmation-retry").count();
			notes.push(`3. 失敗表示=${errored} / 再試行ボタン=${retry}（エラーだけが言葉を持つ）`);
			return;
		}

		// 確定: ✓ は 2000ms しか出ないため、出現を locator 待ちで掴んで即撮る
		const confirmed = page.getByTestId("search-location-autocomplete-confirmation-confirmed");
		let sawCheck = false;
		try {
			await confirmed.waitFor({ state: "visible", timeout: DETAILS_DELAY_MS + 5000 });
			sawCheck = true;
		} catch {
			notes.push("⚠️ 確定の ✓ を観測できなかった。");
		}
		await shot("04-confirmed");
		const valueAfterConfirm = await input.inputValue().catch(() => "(取得失敗)");
		notes.push(`3. 確定直後: ✓ 観測=${sawCheck} / 入力値=${valueAfterConfirm}（正式地名へ置き換わっていること）`);

		// ✓ が黙って消えた後（成功文言は最後まで存在しない）
		await page.waitForTimeout(2500);
		await shot("05-after");
		const checkLeft = await confirmed.count();
		const valueSettled = await input.inputValue().catch(() => "(取得失敗)");
		notes.push(`4. 2.5秒後: ✓ 残存=${checkLeft}（0が正） / 入力値=${valueSettled}`);
	},
});

await writeNote(NAME, notes);
console.log(notes.join("\n"));
