import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 🔗 共有リンク（#721）を E2E から扱うためのユーティリティ。
 *
 * 共有リンクの作成は API 経由でしかできない（`preview_title` / `preview_image_path` は
 * サーバ側 Resolver が作るため、DB を直接いじる代替がない）。
 */

/** API のベース URL。ビルド時に app へ焼き込まれるものと同じ値を使う */
function apiBase(): string {
	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。e2e-web/.env に設定するか、eas-cli env:pull を実行してください。",
		);
	}
	return base.replace(/\/+$/, "");
}

/**
 * 実運用で共有カードを取りに来る代表的な UA と、通常のブラウザ UA。
 *
 * Dynamic Rendering を採らない（UA で出し分けない）ことを固定するために使う。
 */
export const SHARE_CRAWLER_USER_AGENTS = [
	"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
	"Twitterbot/1.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
];

/** ブラウザの localStorage から Supabase の access_token を取り出す */
async function readAccessToken(page: Page): Promise<string> {
	const token = await page.evaluate(() => {
		const key = Object.keys(window.localStorage).find(
			(k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
		);
		if (!key) return null;
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		try {
			return (JSON.parse(raw) as { access_token?: string }).access_token ?? null;
		} catch {
			return null;
		}
	});
	if (!token) throw new Error("Supabase の access_token を取得できませんでした（匿名セッション未確立）");
	return token;
}

/**
 * 実在する dish_media を 1 件拾って共有リンクを作る。
 *
 * ⚠️ ID を固定値でハードコードしないこと。dev DB の中身は入れ替わるため、
 * 固定 ID は「ある日突然 404 で落ちる」テストになる。検索 API から実データを取る。
 *
 * @returns 作成した共有リンクの token / url と、対象にした dish_media の ID
 */
export async function createShareLinkViaApi(
	page: Page,
	request: APIRequestContext,
): Promise<{ token: string; url: string; dishMediaId: string }> {
	const accessToken = await readAccessToken(page);
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
	};

	// 検索結果から実在する dish_media を 1 件拾う。
	// 画面操作で取ると、チュートリアルや位置情報の許可など本題と無関係な理由で落ちる
	const searchResponse = await request.get(`${apiBase()}/v1/dish-media?limit=1`, { headers });
	if (!searchResponse.ok()) {
		throw new Error(`dish_media の取得に失敗しました: ${searchResponse.status()}`);
	}
	const searchBody = (await searchResponse.json()) as {
		data?: { data?: Array<{ dish_media?: { id?: string }; id?: string }> } | Array<{ id?: string }>;
	};
	const dishMediaId = extractFirstDishMediaId(searchBody);
	if (!dishMediaId) {
		throw new Error(
			"dev の dish_media が 0 件のため共有リンクを作れません（前提条件の不足であってバグではない）",
		);
	}

	const createResponse = await request.post(`${apiBase()}/v1/share-links`, {
		headers,
		data: { target: { type: "dish_media", params: { ids: [dishMediaId] } }, locale: "ja-JP" },
	});
	if (!createResponse.ok()) {
		throw new Error(
			`共有リンクの作成に失敗しました: ${createResponse.status()} ${await createResponse.text()}`,
		);
	}
	const created = (await createResponse.json()) as { data: { token: string; url: string } };
	return { token: created.data.token, url: created.data.url, dishMediaId };
}

/**
 * `/s/:token` を **素の HTTP GET** で取る（ブラウザを介さない＝ JS を実行しない）。
 *
 * SNS のクローラと同じ見え方になるので、「JS 無しで OGP が読めるか」を直接検証できる。
 */
export async function fetchSharePage(
	request: APIRequestContext,
	token: string,
	userAgent?: string,
): Promise<{ status: number; body: string; contentType: string }> {
	const response = await request.get(`${apiBase()}/s/${token}`, {
		headers: userAgent ? { "User-Agent": userAgent } : undefined,
		failOnStatusCode: false,
	});
	return {
		status: response.status(),
		body: await response.text(),
		contentType: response.headers()["content-type"] ?? "",
	};
}

/**
 * 検索レスポンスから dish_media の ID を 1 件取り出す。
 *
 * レスポンス形（`data.data[].dish_media.id` か `data[].id` か）は API の版で揺れるので、
 * どちらでも拾えるようにしておく。ここで固定すると、無関係な API 変更でこの spec が落ちる。
 */
function extractFirstDishMediaId(body: unknown): string | null {
	const data = (body as { data?: unknown }).data;
	const list = Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? []);
	const first = Array.isArray(list) ? list[0] : undefined;
	if (!first || typeof first !== "object") return null;
	const nested = (first as { dish_media?: { id?: string } }).dish_media?.id;
	return nested ?? (first as { id?: string }).id ?? null;
}
