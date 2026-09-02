// 料理提案（Topics）画面のエビデンス。カルーセルのレイアウトと、取得失敗時の挙動を撮る。
//
// この画面は到達に 2 つの前提が要る。どちらも欠けるとエラー画面になるだけなので、
// ここで両方そろえてある（自分で組み直さないこと）。
//   1. searchParams(JSON) をクエリで渡す
//   2. v1/dish-categories/recommendations を BaseResponse の封筒で返す
//
// 使い方:
//   node .claude/skills/evidence-video/scenarios/topics.mjs           … 正常系（カルーセル）
//   EVIDENCE_FAIL_TIMES=2 node .../topics.mjs                          … 失敗 → 再試行 → 回復
import { BASE, ok, record, solidCard, dismissTutorial, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "topics";
// 推薦 API を最初の N 回だけ 500 にする。REL-03（その場再試行）の検証に使う
const FAIL_TIMES = Number(process.env.EVIDENCE_FAIL_TIMES || 0);

const SOLIDS = ["e8734a", "3a7bd5", "43a047", "8e44ad", "e0a800", "d64550"];
const CATS = [
	["ラーメン", "こってり豚骨で満たされる", "夜に食べたくなる定番"],
	["寿司", "握りたてを一貫ずつ", "少し贅沢したい日に"],
	["焼き鳥", "炭火の香りで一杯", "軽く飲みたいときに"],
	["カレー", "スパイスで目が覚める", "手早く済ませたいときに"],
	["天ぷら", "揚げたてのころもを", "落ち着いて食べたい日に"],
	["餃子", "焼き目のついた一皿", "みんなで分けられる"],
];
const RECOMMENDATIONS = CATS.map(([category, topicTitle, reason], i) => ({
	category,
	topicTitle,
	reason,
	categoryId: `cat-${i + 1}`,
	imageUrl: `https://evidence.invalid/img-${i}.svg`,
	deepDiveFeatures: [],
	isSaved: false,
}));

const SEARCH_PARAMS = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	distance: 800,
	priceLevels: ["PRICE_LEVEL_MODERATE"],
	timeSlot: "dinner",
	scene: "friends",
	taste: null,
	diningPace: null,
	coreIngredient: null,
	localLanguageCode: "ja",
};

let calls = 0;
const notes = [];
const mock = (url) => {
	const img = url.match(/evidence\.invalid\/img-(\d+)\.svg/);
	if (img) return { contentType: "image/svg+xml", body: solidCard(SOLIDS[Number(img[1]) % SOLIDS.length]) };
	if (url.includes("dish-categories/recommendations")) {
		calls += 1;
		const fail = calls <= FAIL_TIMES;
		notes.push(`推薦 API 呼び出し #${calls} → ${fail ? "500" : "200"}`);
		if (fail) return { status: 500, body: JSON.stringify({ success: false, message: "evidence-forced-failure" }) };
		return { body: ok(RECOMMENDATIONS) };
	}
	return null;
};

const url = `${BASE}/ja-JP/search/dish-categories?searchParams=${encodeURIComponent(JSON.stringify(SEARCH_PARAMS))}`;

await record({
	name: NAME,
	mock,
	flow: async (page, shot) => {
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(9000);

		if (FAIL_TIMES > 0) {
			await shot("01-error");
			const body = await page.locator("body").innerText();
			notes.push("エラー画面のテキスト: " + JSON.stringify(body.split("\n").slice(0, 4).join(" / ")));
			// 失敗した回数ぶん「再試行」を押し、回復まで撮る
			for (let i = 0; i <= FAIL_TIMES; i++) {
				const retry = page.getByText(/再試行|もう一度|やり直|リトライ/).first();
				if (!(await retry.count())) {
					notes.push(i === 0 ? "⚠️ 再試行ボタンが見つからない（未修正のブランチか）" : "再試行ボタンは消えた（回復）");
					break;
				}
				await retry.click();
				await page.waitForTimeout(i === FAIL_TIMES ? 8000 : 2500);
				await shot(`0${i + 2}-after-retry-${i + 1}`);
			}
			await dismissTutorial(page);
			await shot("09-recovered");
			return;
		}

		await dismissTutorial(page);
		await shot("01-carousel");
		// ⚠️ カードに出るのは `topicTitle` と `reason` であって `category` ではない。
		// `category`（"ラーメン"）を探すと **描画できていても 0 件**になり、誤検知する。
		const found = await page.getByText(CATS[0][1], { exact: false }).count();
		notes.push(`カード（"${CATS[0][1]}"）の一致数: ${found}`);
		if (found === 0) notes.push("⚠️ カードが描画されていない。到達に失敗している可能性がある。");
		// ⚠️ このカルーセルは **スワイプで送れない**。実測（3 方式）で、カード本体を
		// どこで押しても «タップ» と解釈され、結果画面 → 0 件フォールバック → ルートへ
		// 飛んでしまう。右上のブロックアイコンから引くとカルーセルは送れるが、
		// 離した瞬間にブロック確認ダイアログが開く。
		//
		// したがって既定では送らない。**この画面のレイアウト（カード幅・左右の見切れ方）は
		// 静止画で十分に映る**し、スナップ位置は e2e spec 側（実座標でアサートする
		// topic-card-full-bleed.spec.ts）が担保している。
		// 送った «ふり» の動画を出す方が誤解を招くので出さない。
		//
		// どうしても操作を映したいときは EVIDENCE_TRY_SWIPE=1 を渡す。その場合も
		// 遷移してしまったかどうかを必ずメモへ残す。
		await page.waitForTimeout(1200);
		await shot("02-carousel-hold");
		if (process.env.EVIDENCE_TRY_SWIPE === "1") {
			await page.mouse.move(200, 300);
			await page.mouse.down();
			await page.waitForTimeout(400);
			for (let x = 200; x >= 60; x -= 20) {
				await page.mouse.move(x, 300);
				await page.waitForTimeout(25);
			}
			await page.mouse.up();
			await page.waitForTimeout(1800);
			const stayed = page.url().includes("/search/dish-categories");
			notes.push(`スワイプ試行: topics 画面に留まった = ${stayed}`);
			if (!stayed) notes.push("⚠️ スワイプがタップと解釈され画面遷移した。動画のこの部分は根拠に使えない。");
			await shot("03-after-swipe-attempt");
		}
	},
});
await writeNote(NAME, [`# ${NAME}`, "", ...notes]);
console.log(notes.join("\n"));
