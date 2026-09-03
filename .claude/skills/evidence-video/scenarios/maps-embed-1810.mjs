/*
#843 / PR #1810 アプリ内地図（Maps Embed）のエビデンス。

⚠️ 認証・API はすべてモック。**地図の中身は Google ではなく、このシナリオが差し込んだ
   代替の HTML** である（本物を出すには GCP で Maps Embed API を有効化し
   `GOOGLE_MAPS_EMBED_API_KEY` を設定する必要がある）。
   ここで確かめられるのは «埋め込み枠がモーダルの中で正しい大きさで出ること»、
   および «キー未設定（token 発行失敗）のときにモーダルを一度も開かず外部ブラウザへ
   直行すること» の 2 点。地図そのものが描けることの証明ではない。偽らないこと。

2 通り撮る:
  - token 発行が成功 → 埋め込み枠が出る（フッタの「Google マップで開く」は出ない）
  - token 発行が失敗 → #1810 PL レビュー 3番【修正後】モーダルを一度も開かず、
    ボタン 1 回で外部ブラウザ（新規タブ）へ直行する（main と同じ体験）。
    修正前はここでモーダルが開いてから「表示できません」→ もう一度ボタンを押す、
    という無意味な往復が挟まっていた。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "maps-embed-1810";
const PRESET = process.env.EVIDENCE_PRESET || "default";

/** 地図の代わりに差し込む板。Google の地図ではないことが画面上でも分かるようにする */
const STUB_MAP = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>html,body{margin:0;height:100%;font-family:sans-serif}
.m{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;
   background:repeating-linear-gradient(45deg,#e8eef5,#e8eef5 12px,#dde6f0 12px,#dde6f0 24px);color:#456}
</style></head><body><div class="m">Maps Embed の埋め込み枠<br/><small>（モック。実際は Google の地図が入る）</small></div></body></html>`;

/** `?fail=1` を付けて起動すると token 発行を失敗させ、縮退の見た目を撮る */
const shouldFailToken = () => process.env.EVIDENCE_FAIL_TOKEN === "1";

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		// 埋め込み本体。iframe の src と、web 版が事前に投げる fetch の両方がここへ来る
		if (url.includes("/v1/maps/embed?")) return { body: STUB_MAP, contentType: "text/html" };

		if (url.includes("/v1/maps/embed-token")) {
			if (shouldFailToken()) return { status: 503, body: JSON.stringify({ errorCode: "SERVICE_UNAVAILABLE" }) };
			return { body: ok({ token: "evidence-stub-token", expiresAt: "2099-01-01T00:00:00Z" }) };
		}

		// 店舗詳細（写真なしの店）。ここの「Google マップで開く」からモーダルを開く
		const m = /\/v1\/restaurants\/([^/?]+)(\?.*)?$/.exec(url);
		if (m && m[1] !== "search")
			return {
				body: ok({
					restaurant: {
						id: m[1],
						name: "エビデンス用ラーメン",
						imageUrls: { md: null },
						google_place_id: "place-evidence",
					},
					meta: { averageRating: 4.1, reviewCount: 8, totalCents: 0, maxEndDate: null },
				}),
			};
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url)) return { body: ok({ data: [], nextCursor: null }) };
		return null;
	},
	flow: async (page, shot) => {
		// #1810 PL レビュー 3番: token 発行に失敗したときに実際に window.open が
		// 呼ばれたか（= 外部ブラウザへ渡したか）を、ブラウザの popup 許可設定に
		// 依存せず直接観測する。ヘッドレス Chromium は「ユーザー操作から
		// await を挟んだ window.open」を popup として許可しないことがあり
		// （実測: `context().waitForEvent("popup")` がタイムアウトした）、
		// openExternalUrl.ts 自身が明記しているとおりブロックされても
		// throw もフォールバックもしない仕様なので、popup イベント待ちでは
		// 「呼ばれたのに映らない」を「呼ばれていない」と誤判定してしまう。
		const windowOpenCalls = [];
		await page.exposeFunction("__evidenceOnWindowOpen", (url) => windowOpenCalls.push(url));
		await page.addInitScript(() => {
			const originalOpen = window.open;
			window.open = (...args) => {
				window.__evidenceOnWindowOpen?.(args[0]);
				return originalOpen.apply(window, args);
			};
		});

		await page.goto("http://localhost:8788/ja-JP/restaurant/r-evidence", { waitUntil: "domcontentloaded" });
		await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
		await page.waitForTimeout(800);
		await shot("01-restaurant-detail");

		await page.getByTestId("restaurant-detail-google-maps-button").click();

		if (shouldFailToken()) {
			// #1810 PL レビュー 3番【修正後】token 発行が失敗したら、モーダルを一度も
			// 開かずボタン 1 回で外部ブラウザへ直行する（main と同じ体験）。
			await page.waitForTimeout(2000);
			if (await page.getByTestId("maps-embed-modal").count()) {
				throw new Error("token 発行に失敗したのにモーダルが開いた（#1810 PL レビュー 3番の回帰）");
			}
			if (windowOpenCalls.length !== 1 || !windowOpenCalls[0].startsWith("https://www.google.com/maps/search/")) {
				throw new Error(`外部ブラウザへの window.open が期待どおり呼ばれていない: ${JSON.stringify(windowOpenCalls)}`);
			}
			// 元の画面（店舗詳細）のまま、モーダルが一切出ていないことを撮る
			await shot("03-no-modal-external-fallback");
			return;
		}

		await page.getByTestId("maps-embed-modal").waitFor({ timeout: 15_000 });
		await page.waitForTimeout(1500);
		await shot("02-modal-embed-frame");
	},
});
