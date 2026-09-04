import { test, expect } from "../../fixtures/test";
import { apiBase, buildApiHeaders } from "../../utils/eatenLifecycle";

/**
 * 🗺️ #843 ①② Google の上限に当たったときの退避先「アプリ内地図」が、**実環境で本当に地図を出せるか**
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 *
 * ## なぜ実 API を叩くのか
 *
 * #1810 の既存エビデンスは **API をモックした web** で撮ったもので、映っているのは
 * シナリオが差し込んだ «代替の板» である。**Google の地図が実際に出るところは誰も見ていない。**
 *
 * この経路は API キー（`GOOGLE_MAPS_EMBED_API_KEY`）が Cloud Run に入っているかどうかで
 * 結果が変わる。キーが無ければ `POST /v1/maps/embed-token` が 503 を返し、
 * アプリは従来の外部ブラウザ導線へ縮退する（= 地図は出ない）。
 * **設定されたことを «設定した» で終わらせず、ここで実際に確かめる。**
 *
 * ## Google Places は 1 回も叩かない
 *
 * Maps Embed API は Places とは別の SKU で、**無料・上限なし**である。
 * このテストは Place Details も Text Search も呼ばないので、
 * 「place detail を使うので CI にしてはダメ」の制約には当たらない。
 *
 * ## dev DB への影響
 *
 * 無し（読むだけ・作らない）。`@mutation` ではないので Tier 2 で常時回せる。
 */

/** Maps Embed API の埋め込み URL。ここに一致しなければ «Google の地図» ではない */
const MAPS_EMBED_SRC = /https:\/\/www\.google\.com\/maps\/embed\/v1\//;

test.describe("#843 アプリ内地図（Maps Embed）", () => {
	test("embed-token が発行でき、その HTML に Google の埋め込み地図が入っている", async ({ page }) => {
		const headers = await buildApiHeaders(page);
		const base = apiBase();

		/*
		1 段目: 短命トークンの発行（認証必須）。
		⚠️ ここが 503 SERVICE_UNAVAILABLE なら **Cloud Run に API キーが入っていない**。
		   その場合アプリは外部ブラウザへ縮退するので «壊れて» は見えないが、地図も出ない。
		*/
		const tokenRes = await page.request.post(`${base}/v1/maps/embed-token`, {
			headers,
			data: { mode: "search", q: "ラーメン 東京駅", hl: "ja" },
		});
		expect(
			tokenRes.status(),
			`embed-token が ${tokenRes.status()}。503 なら Cloud Run の GOOGLE_MAPS_EMBED_API_KEY 未設定を疑う`,
		).toBe(201);

		const token = ((await tokenRes.json()) as { data: { token: string } }).data.token;
		expect(token, "トークンが空").toBeTruthy();

		/*
		2 段目: そのトークンで HTML を取る（ガード無し。トークンを持っていること自体が証明）。
		WebView / iframe は URL を «文書として» 読むので Authorization を付けられない、
		というのがこの 2 段構成の理由（maps.controller.ts の設計コメント）。
		*/
		const pageRes = await page.request.get(`${base}/v1/maps/embed`, {
			params: { token },
		});
		expect(pageRes.status()).toBe(200);

		const html = await pageRes.text();

		/*
		⚠️ **«HTML が返った» で満足しない。** キーが空でも枠だけの HTML は返りうる。
		   Maps Embed API の URL が iframe の src に入っていることまで見る。
		*/
		expect(html, "iframe が無い").toContain("<iframe");
		expect(html, "Maps Embed API の URL が入っていない（= Google の地図ではない）").toMatch(MAPS_EMBED_SRC);

		/*
		⚠️ **API キーが URL に載っていることまで見る。** `key=` が空だと Google 側が
		   «このページを読み込めません» を返し、ユーザーには真っ白に見える。
		   ⚠️ 鍵の値そのものはログにも失敗メッセージにも出さない（`toMatch` の結果だけを見る）。
		*/
		expect(html, "key= が空（キーが Cloud Run に入っていない）").toMatch(/[?&]key=[^&"'\s]+/);
	});
});
