/*
#1629 オーナー実機報告（食べたを記録）のうち、**画面の中で完結するもの**を 1 本で撮る。

| 見るもの | オーナーの言葉 |
| --- | --- |
| ① 店名検索の残留 | 「該当するお店が見つかりません」が消えない / 入力文字が残る / ×で選んだ店が出る |
| ② カテゴリの候補 | 「このお店の料理が **9483163** って出てる」（カテゴリ id が表示名になっていた） |
| ③ オートコンプリート | 「オートコンプリートじゃない / 背脂ラーメンと打っても出ない」 |
| ④ 並び | 「料理カテゴリー選択は写真の上に持ってきちゃいましょう」 |
| ⑤ 選び直し | 「メディアを選んだら編集ができなくて困ってます」 |

⚠️ 認証・API はモック。映っているのは «画面の挙動と並び» であって実データではない。
   実 API を叩く経路（店名検索が当たるか等）の証拠にはならない。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const NAME = process.env.EVIDENCE_NAME || "record-flow-1629";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;

const RESTAURANT_ID = "33333333-3333-3333-3333-000000000001";
const MEDIA_ID = "33333333-3333-3333-3333-000000000002";
/** 「うどん」側の投稿。«この店の写真から選ぶ» は **選んだ料理カテゴリーで絞る**ので、こちらが出る */
const UDON_MEDIA_ID = "33333333-3333-3333-3333-000000000003";

const restaurant = {
	id: RESTAURANT_ID,
	name: "エビデンス食堂 渋谷店",
	image_url: IMG,
	imageUrls: { sm: IMG, md: IMG },
	latitude: 35.6595,
	longitude: 139.7005,
};

/**
 * ② の再現材料。**`dish.name` が空**の投稿を 1 件混ぜる。
 * 修正前はこの行の表示名がカテゴリ id（`9483163`）になっていた。
 */
const dishMediaRows = [
	{
		restaurant,
		dish: { id: "d-1", name: "", restaurant_id: RESTAURANT_ID, category_id: "9483163", categoryLabels: null },
		dish_media: {
			id: MEDIA_ID,
			dish_id: "d-1",
			user_id: "u-1",
			media_path: "x",
			media_type: "image",
			thumbnail_path: "x",
			created_at: "2026-08-20T00:00:00.000Z",
			deleted_at: null,
			isMine: false,
			isSaved: false,
			isLiked: false,
			likeCount: 0,
			mediaUrl: IMG,
			thumbnailImageUrl: IMG,
		},
		dish_reviews: [],
	},
	{
		restaurant,
		dish: {
			id: "d-2",
			name: "udon",
			restaurant_id: RESTAURANT_ID,
			category_id: "cat-udon",
			categoryLabels: { ja: "うどん", en: "Udon" },
		},
		dish_media: {
			id: "33333333-3333-3333-3333-000000000003",
			dish_id: "d-2",
			user_id: "u-1",
			media_path: "x",
			media_type: "image",
			thumbnail_path: "x",
			created_at: "2026-08-20T00:00:00.000Z",
			deleted_at: null,
			isMine: false,
			isSaved: false,
			isLiked: false,
			likeCount: 0,
			mediaUrl: IMG,
			thumbnailImageUrl: IMG,
		},
		dish_reviews: [],
	},
];

const notes = [];

/** ① の前半は 0 件、後半は 1 件。同じ欄で «見つからない → 決まる» を続けて撮るため */
let searchReturnsHit = false;

const mock = (url) => {
	if (url.includes("/v1/restaurants/search")) return {
			body: ok(
				searchReturnsHit
					? [
							// ⚠️ 行の形は `{ restaurant, meta }`。素の restaurant を返すと描画側が落ちる
							//    （#1629 のクラッシュはこれと同じ形。壊れた行を捨てる修正を入れてある）
							{ restaurant, meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null } },
						]
					: [],
			),
		};
	// ③ 料理カテゴリーのマスタ。修正前はここを **引いてすらいなかった**
	if (url.includes("/v1/dish-category-variants"))
		return {
			body: ok([
				{ dishCategoryId: "cat-abura", label: "背脂ラーメン" },
				{ dishCategoryId: "cat-ramen", label: "ラーメン" },
			]),
		};
	// ② / ⑤ その店の投稿（カテゴリ候補と «この店の写真から選ぶ» の両方がこれを読む）
	if (url.includes(`/v1/restaurants/${RESTAURANT_ID}/dish-media`)) return { body: ok({ data: dishMediaRows }) };
	if (url.includes("/v1/users/me/dishes")) return { body: ok({ data: [], nextCursor: null }) };
	return null;
};

const textOf = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();

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

		await page.goto(`${BASE}/ja-JP/add-record`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(5000);
		await page.getByTestId("sns-import-tab-eaten").first().click();
		await page.waitForTimeout(1500);
		await shot("01-eaten-tab");

		// ── ① 0 件 → «該当するお店が見つかりません» が出る ──
		const input = page.getByTestId("sns-import-eaten-restaurant-search-input").first();
		await input.fill("焼き鳥番長");
		await page.waitForTimeout(2500);
		await shot("02-no-results");
		notes.push(
			(await textOf(page)).includes("見つかりません")
				? "1. 前提: 0 件なので «該当するお店が見つかりません» が出ている"
				: "1. ⚠️ 前提が作れていない（0 件表示が出ていない）。以降の判定は当てにならない",
		);

		// ── ① 店が決まったら、打っていた文字も «見つかりません» も畳まれる ──
		searchReturnsHit = true;
		await input.fill("エビデンス");
		await page.waitForTimeout(2500);
		await shot("03-search-hit");
		const hit = page.getByText("エビデンス食堂 渋谷店", { exact: false }).first();
		if (!(await hit.count())) {
			notes.push("⚠️ 検索結果が出ない。以降は撮れていない");
			writeNote(NAME, notes);
			return;
		}
		await hit.click();
		await page.waitForTimeout(3000);
		await shot("04-restaurant-selected");
		notes.push(
			!(await textOf(page)).includes("見つかりません")
				? "2. ✅ 店が決まった時点で «見つかりません» は消えている（打った文字も残っていない）"
				: "2. ❌ 店が決まっても «見つかりません» が残っている",
		);

		// ── ② その店の料理の候補にカテゴリ id が出ていないこと ──
		await page.waitForTimeout(1500);
		await shot("05-dish-category-step");
		const stepText = await textOf(page);
		notes.push(
			!stepText.includes("9483163")
				? "3. ✅ 候補にカテゴリ id（9483163）が出ていない。名前の取れない行は候補から外れている"
				: "3. ❌ 候補にカテゴリ id が出ている",
		);
		notes.push(
			stepText.includes("うどん")
				? "4. ✅ labels から «うどん» を解決している（その店での呼び名は 'udon'）"
				: "4. ❌ labels を見ていない（'udon' のまま or 出ていない）",
		);

		// ── ③ 打ったらマスタも引く（その店に記録が無い料理も出る） ──
		const catInput = page.getByTestId("review-dish-category-step-search-input").first();
		if (!(await catInput.count())) {
			notes.push("⚠️ 料理カテゴリーの入力欄が出ていない。以降は撮れていない");
			writeNote(NAME, notes);
			return;
		}
		await catInput.fill("背脂");
		await page.waitForTimeout(2500);
		await shot("06-autocomplete");
		notes.push(
			(await textOf(page)).includes("背脂ラーメン")
				? "5. ✅ その店に記録が無い «背脂ラーメン» が候補に出る（マスタを引いている）"
				: "5. ❌ マスタの候補が出ない（オートコンプリートになっていない）",
		);

		// ── ④ 料理カテゴリー行が写真より «上» にあること ──
		await catInput.fill("");
		await page.waitForTimeout(2000);
		const udon = page.getByText("うどん", { exact: true }).first();
		if (await udon.count()) await udon.click();
		await page.waitForTimeout(3000);
		await shot("07-media-step");

		const rowBox = await page.getByTestId("review-dish-category-row").first().boundingBox().catch(() => null);
		const mediaBox = await page.getByTestId("review-media-slot").first().boundingBox().catch(() => null);
		notes.push(
			rowBox && mediaBox
				? rowBox.y < mediaBox.y
					? `6. ✅ 料理カテゴリー行が写真より上にある（行 y=${Math.round(rowBox.y)} < 写真 y=${Math.round(mediaBox.y)}）`
					: `6. ❌ まだ写真より下にある（行 y=${Math.round(rowBox.y)} >= 写真 y=${Math.round(mediaBox.y)}）`
				: "6. ⚠️ 位置を測れなかった（どちらかが描かれていない）",
		);
		notes.push(
			(await textOf(page)).includes("うどん") && !(await textOf(page)).includes("udon")
				? "7. ✅ «この店の写真から選ぶ» のタイルも «うどん»（ローマ字の 'udon' ではない）"
				: "7. ❌ タイルの見出しがローマ字のまま",
		);

		// ── ⑤ «この店の写真から選ぶ» で選んだあと、選び直せること ──
		const existing = page.getByTestId(`review-existing-dish-media-item-${UDON_MEDIA_ID}`).first();
		if (!(await existing.count())) {
			notes.push("⚠️ «この店の写真から選ぶ» の候補が出ていない。⑤ は撮れていない");
			writeNote(NAME, notes);
			return;
		}
		await existing.click();
		await page.waitForTimeout(3000);
		await shot("08-media-picked");

		// #1629【オーナー指示】料理カテゴリー行は押せない（写真と食い違わせないため）
		const categoryRow = page.getByTestId("review-dish-category-row").first();
		const rowDisabled = await categoryRow.evaluate((el) => {
			const target = el.closest("[aria-disabled]") ?? el;
			return target.getAttribute("aria-disabled") === "true" || target.hasAttribute("disabled");
		}).catch(() => null);
		notes.push(
			rowDisabled === true
				? "10. ✅ 料理カテゴリー行は押せない（後から変えられない）"
				: `10. ❌ 料理カテゴリー行がまだ押せる（aria-disabled=${String(rowDisabled)}）`,
		);

		const reselect = page.getByTestId("review-reselect-media");
		notes.push(
			(await reselect.count()) > 0
				? "8. ✅ 写真を決めたあとに «写真を選び直す» が出る"
				: "8. ❌ 写真を決めたら選び直す口が無い（オーナー報告の «編集できない»）",
		);

		// #1629【オーナー指示】«選び直す» と «自分の写真に差し替える» は同時に出さない
		const replaceCount = await page.getByTestId("review-replace-with-my-photo").count();
		const reselectCount = await reselect.count();
		notes.push(
			reselectCount + replaceCount === 1
				? `11. ✅ 写真の作り直しの入口は 1 つだけ（選び直す=${reselectCount} / 差し替える=${replaceCount}）`
				: `11. ❌ 入口が ${reselectCount + replaceCount} 個ある（選び直す=${reselectCount} / 差し替える=${replaceCount}）`,
		);
		if (reselectCount > 0) {
			const box = await reselect.first().boundingBox();
			const preview = await page.getByTestId("review-media-slot").first().boundingBox();
			notes.push(
				box && preview && box.x + box.width > preview.x + preview.width / 2
					? "12. ✅ ボタンは右下寄せ"
					: "12. ❌ ボタンが右下に寄っていない",
			);
		}

		if ((await reselect.count()) > 0) {
			await reselect.first().click();
			await page.waitForTimeout(2500);
			await shot("09-reselected");
			notes.push(
				(await page.getByTestId("review-add-photo-placeholder").count()) > 0
					? "9. ✅ 押すと写真の選び方へ戻る（最初から選び直せる）"
					: "9. ❌ 押しても選び方へ戻らない",
			);
		}

		writeNote(NAME, notes);
	},
});

console.log(`done -> ${OUT}`);
