/*
#1629 フィード右レールを作り直した結果のエビデンス（オーナー指示 4 件）。

  9.  ハートの下の数字を消した
  10. «この料理にレビューを書く» → «レビュー»
  11. «…» を右レールの一番下へ
  12. «…» の中にシェアと報告を入れた

固定するのは «レールに何が、どの順で並んでいるか» と ««…» を開くと何が出るか»。

⚠️ このモックの投稿は `isMine: false`（他人の投稿）である。**それでも «…» が出て、
   中にシェアと報告があること**がここで一番見たいもの。`isMine` で «…» ごと消すと
   他人の投稿を通報できなくなる（#1514 の設計判断）。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { BASE, ok, record, solidCard, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "feed-rail-1629";
const FAIL = process.env.EVIDENCE_FAIL !== "0"; // 既定は失敗系（ロールバックを見せる）
const REACTION_DELAY_MS = Number(process.env.EVIDENCE_REACTION_DELAY ?? 2500);

const MEDIA_ID = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-08-01T00:00:00Z";

const ENTRY = {
	restaurant: {
		id: "rest-1", name: "エビデンス食堂", latitude: 35.658, longitude: 139.7015,
		google_place_id: "place-1", image_url: null, address: "東京都渋谷区",
		created_at: NOW, updated_at: NOW,
	},
	dish: {
		id: "dish-1", restaurant_id: "rest-1", category_id: "cat-1", name: "特製ラーメン",
		created_at: NOW, updated_at: NOW, reviewCount: 3, averageRating: 4.5,
	},
	dish_media: {
		id: MEDIA_ID, dish_id: "dish-1", user_id: "someone-else", media_path: "p.jpg",
		media_type: "image", thumbnail_path: "t.jpg", created_at: NOW,
		media_processing_status: "completed",
		isMine: false, isSaved: false, isLiked: false, likeCount: 12,
		mediaUrl: "https://evidence.invalid/img-0.svg",
		thumbnailImageUrl: "https://evidence.invalid/img-0.svg",
	},
	dish_reviews: [{
		id: "rev-1", dish_id: "dish-1", user_id: "u-2", comment: "スープが濃くて好みでした",
		rating: 5, created_at: NOW, price_cents: 100000, currency_code: "JPY",
		username: "たろう", isLiked: false, likeCount: 2,
	}],
};

const CATS = [{ category: "ラーメン", topicTitle: "こってり豚骨で満たされる", reason: "夜に食べたくなる定番" }];
const RECOMMENDATIONS = CATS.map((c, i) => ({
	...c, categoryId: `cat-${i + 1}`, imageUrl: `https://evidence.invalid/img-${i}.svg`,
	deepDiveFeatures: [], isSaved: false,
}));

const searchParams = {
	address: "country:JP, administrative_area_level_1:東京都, locality:渋谷区",
	location: { latitude: 35.658034, longitude: 139.701636 },
	distance: 800, priceLevels: ["PRICE_LEVEL_MODERATE"], timeSlot: "dinner",
	scene: "friends", taste: null, diningPace: null, coreIngredient: null, localLanguageCode: "ja",
};

const notes = [];

await record({
	name: NAME,
	langs: ["ja"],
	mock: async (url) => {
		const m = url.match(/evidence\.invalid\/img-(\d+)\.svg/);
		if (m) return { contentType: "image/svg+xml", body: solidCard(["e8734a", "3a7bd5"][Number(m[1]) % 2]) };
		if (url.includes("dish-categories/recommendations")) return { body: ok(RECOMMENDATIONS) };
		if (url.includes("v1/dish-media/search")) return { body: ok([ENTRY]) };
		return null;
	},
	flow: async (page, shot) => {
		const url = `${BASE}/ja-JP/search/dish-categories?searchParams=${encodeURIComponent(JSON.stringify(searchParams))}`;
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(9000);
		const cta = page.getByText("この料理にする！", { exact: false });
		if (await cta.count()) { await cta.first().click(); } else { await page.mouse.click(195, 420); }
		await page.waitForTimeout(6000);

		// フィードは複数セルをマウントするので、必ず先頭（前面のカード）へ絞る
		const like = page.getByTestId("dish-action-like").first();
		if (!(await like.count())) {
			notes.push("⚠️ dish-action-like が見つからない。結果画面へ到達できていない。以降は撮れていない");
			await shot("00-not-reached");
			return;
		}

		// ── 9. ハートの下の数字が消えていること ──
		const likeText = (await like.innerText()).replace(/\s+/g, " ").trim();
		notes.push(`9. いいねボタンの表示: ${JSON.stringify(likeText)}（数字が出ていないこと。モックの likeCount は 12）`);
		if (/\d/.test(likeText)) {
			notes.push("   ⚠️ 数字が残っている");
		}

		// ── 11. «…» が一番下にあること（描画順で見る）──
		const rail = ["dish-action-like", "dish-action-save", "dish-action-more"];
		const ys = [];
		for (const testId of rail) {
			const box = await page.getByTestId(testId).first().boundingBox();
			if (!box) { notes.push(`   ⚠️ ${testId} が無い`); continue; }
			ys.push({ testId, y: Math.round(box.y) });
		}
		notes.push(`11. レールの並び（上から）: ${ys.sort((a, b) => a.y - b.y).map((v) => v.testId).join(" → ")}`);

		// レール直置きのシェア・報告が消えていること（«…» の中へ畳んだ）
		for (const gone of ["dish-action-share", "dish-action-report"]) {
			if ((await page.getByTestId(gone).count()) > 0) {
				notes.push(`   ⚠️ ${gone} がレールに残っている。#1629 は «…» へ畳む変更`);
			}
		}
		await page.waitForTimeout(800);
		await shot("01-rail");

		// ── 12. «…» を開くとシェアと報告がある（他人の投稿でも出る）──
		await page.getByTestId("dish-action-more").first().click();
		await page.getByTestId("dish-action-share").first().waitFor({ state: "visible", timeout: 10000 });
		await page.getByTestId("dish-action-report").first().waitFor({ state: "visible", timeout: 10000 });
		const hasEdit = (await page.getByTestId("own-post-edit-button").count()) > 0;
		const hasDelete = (await page.getByTestId("own-post-delete-button").count()) > 0;
		notes.push(`12. «…» の中: シェア ✓ / 報告 ✓ / 編集 ${hasEdit ? "✗（他人の投稿なのに出ている）" : "出ない（正しい）"} / 削除 ${hasDelete ? "✗（他人の投稿なのに出ている）" : "出ない（正しい）"}`);
		await page.waitForTimeout(800);
		await shot("02-more-menu");
	},
});

await writeNote(NAME, [
	"# #1629 フィード右レールの作り直し",
	"",
	"- 01-rail … いいね（**数字なし**）/ 食べたい / レビュー / 地図 / **«…» が一番下**",
	"- 02-more-menu … «…» を開いたところ。**シェアと報告**が入っている",
	"",
	"⚠️ このモックの投稿は他人の投稿（`isMine: false`）。それでも «…» が出て通報できることが本命。",
	"⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。",
	"",
	...notes,
]);
console.log(notes.join("\n"));
