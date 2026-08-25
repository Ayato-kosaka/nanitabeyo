/*
#1514 SAF-01 通報のエビデンス。

投稿フィードの「通報する」から通報シートを開き、理由を選んで送信するところまでを撮る。

⚠️ 実データではない。`GET /v1/dish-media?ids=` をモックして 1 件のフィードを作り、
通報の POST もモックが 200 を返すだけ。**dev の DB へは 1 行も書かない**。
それでも「利用者が通報に到達できるか」「シートに何が書いてあるか」は絵で確かめられる。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;
const MEDIA_ID = "11111111-2222-4333-8444-555555555555";

const entry = {
	restaurant: {
		id: "restaurant-1",
		name: "エビデンス食堂",
		image_url: IMG,
		latitude: 35.0,
		longitude: 139.0,
	},
	dish: {
		id: "dish-1",
		name: "テスト料理",
		restaurant_id: "restaurant-1",
		reviewCount: 1,
		averageRating: 4,
		categoryImageUrl: IMG,
	},
	dish_media: {
		id: MEDIA_ID,
		dish_id: "dish-1",
		user_id: "99999999-9999-4999-8999-999999999999",
		media_path: "x",
		media_type: "image",
		thumbnail_path: "x",
		created_at: "2026-08-20T00:00:00.000Z",
		deleted_at: null,
		// 他人の投稿なので «通報する» が出る（自分の投稿だと編集・削除が出る）
		isMine: false,
		isSaved: false,
		isLiked: false,
		likeCount: 3,
		mediaUrl: IMG,
		thumbnailImageUrl: IMG,
		media_processing_status: "completed",
		thumbnail_processing_status: "completed",
	},
	dish_reviews: [],
};

const mock = (url) => {
	if (url.includes("/v1/dish-media") && url.includes("ids="))
		return { body: ok({ items: [entry], notFound: [] }) };
	// #1584 自分の報告履歴。**status は返さない**（API もそもそも返さない）
	if (url.includes("/v1/users/me/content-reports"))
		return {
			body: ok({
				data: [
					{
						id: "report-1",
						targetType: "dish_media",
						reasonCode: "spam",
						createdAt: "2026-08-22T00:00:00.000Z",
					},
					{
						id: "report-2",
						targetType: "dish_reviews",
						reasonCode: "harassment",
						createdAt: "2026-08-18T00:00:00.000Z",
					},
				],
				nextCursor: null,
			}),
		};
	if (url.includes("/v1/content-reports"))
		return { body: ok({ reportId: "report-1", status: "pending", alreadyReported: false }) };
	return null;
};

async function shootScheme(scheme) {
	return record({
		name: `report1514-${scheme}`,
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

			await page.goto(`${BASE}/ja-JP/posts?ids=${MEDIA_ID}`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(4000);
			await shot("01-feed");

			/*
			「通報する」は右側のアクション列にある。

			⚠️ `.first()` が要る。全画面フィードは前後のページも同時に描くので、
			   同じ testID が **3 つ**当たり、Playwright の strict モードが
			   「複数一致」で落ちる（実測で撮影が 1 枚目で止まった）。
			*/
			const reportButton = page.getByTestId("dish-action-report").first();
			await reportButton.waitFor({ state: "visible", timeout: 15000 });
			await reportButton.scrollIntoViewIfNeeded().catch(() => {});
			await shot("02-report-button");

			await reportButton.click();
			await page.waitForTimeout(1200);

			const sheet = page.getByTestId("report-sheet").first();
			await sheet.waitFor({ state: "visible", timeout: 10000 });
			await shot("03-report-sheet");

			/*
			理由を選ぶ。**選ばないと «送信» が disabled のままで、
			クリックしても何も起きない**（ReportContentSheet の `disabled={!reasonCode}`）。
			run 32825715797 はここを踏んで 04 で撮影が止まり、
			#1584 で足した 05 / 06 が 1 枚も撮れないまま «成功» になった。
			*/
			await page.getByTestId("report-reason-spam").first().click();
			await page.waitForTimeout(300);

			const detailsInput = page.getByTestId("report-details-input").first();
			if (await detailsInput.count()) {
				await detailsInput.click().catch(() => {});
				await detailsInput.fill("[E2E] エビデンス撮影のための入力です").catch(() => {});
				await page.waitForTimeout(400);
			}
			await shot("04-report-filled");

			// 撮る前に «送信» が押せる状態か確かめる。disabled のまま先へ進むと
			// 05 以降が撮れないのに撮影自体は成功扱いになる
			const submit = page.getByTestId("report-submit").first();
			await submit.waitFor({ state: "visible", timeout: 10000 });
			if (await submit.isDisabled().catch(() => false)) {
				throw new Error("report-submit が disabled のまま。理由の選択が効いていない");
			}

			/*
			#1584 ここからが «送ったあと» の面。オーナー指摘（受付文言 / 報告履歴）の検証。
			POST はモックが 200 を返すだけなので dev の DB へは 1 行も書かない。
			*/
			await submit.click();
			const accepted = page.getByTestId("report-accepted");
			await accepted.waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("05-accepted");

			/*
			履歴へ移動する。**審査状況が出ていないこと**がこの絵の主眼。

			⚠️ 待つのは `content-reports-header-title` である。`ScreenHeader` は
			   渡された testID を **そのままの形では DOM に出さず**、
			   `${testID}-title` と `${testID}-back` に分けて付ける（#1031 / #1404）。
			   素の `content-reports-header` を待つと、画面が正しく描けていても
			   永久に見つからない（run 32836998579 で実測）。
			*/
			await page.getByTestId("report-accepted-history").click();
			const historyHeader = page.getByTestId("content-reports-header-title");
			await historyHeader.waitFor({ state: "visible", timeout: 10000 });

			// 審査状況を出していないことを «撮る前に» 機械的にも確かめる。
			// 目視だけだと、後から «審査中» ラベルが足されたときに見落とす
			const historyText = await page.locator("body").innerText();
			for (const banned of ["審査中", "対応済み", "却下", "受付済み", "pending", "reviewing", "actioned", "rejected"]) {
				if (historyText.includes(banned)) {
					throw new Error(`報告履歴に審査状況（«${banned}»）が出ている。#1584 のオーナー確定仕様に反する`);
				}
			}
			await page.waitForTimeout(1500);
			await shot("06-history");
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("report1514", [
	"# #1514 SAF-01 通報",
	"",
	"- 01-feed … 他人の投稿のフィード",
	"- 02-report-button … 「通報する」ボタンが出ている状態",
	"- 03-report-sheet … 通報シートを開いた状態（理由の選択肢）",
	"- 04-report-filled … 詳細を入力した状態",
	"- 05-accepted … 送信後の受付。«ご報告いただきありがとうございます» と «あなたの報告履歴» ボタン（#1584）",
	"- 06-history … 報告履歴。**審査状況は出さない**（受付日と理由だけ。#1584 オーナー確定仕様）",
	"",
	"⚠️ API はモック。**dev の DB へは 1 行も書いていない**。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
