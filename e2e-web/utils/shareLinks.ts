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
		const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
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

/** 検索の中心。dev にデータが集まっている都心を固定で使う（東京駅） */
const SEARCH_LOCATION = "35.681236,139.767125";
/** 検索半径 (m)。狭すぎると 0 件になり、広すぎても API が重くなるだけ */
const SEARCH_RADIUS = 5000;
/** 推薦 API へ渡す住所トークン（QueryDishCategoryRecommendationsDto の doc コメントに準拠） */
const SEED_ADDRESS = "country:JP, administrative_area_level_1:Tokyo, locality:Tokyo";

/**
 * 実在する dish_media を 1 件探す。
 *
 * ⚠️ ID をハードコードしないこと。dev DB の中身は入れ替わるため、
 * 固定 ID は「ある日突然 404 で落ちる」テストになる。
 */
async function findAnyDishMediaId(request: APIRequestContext, headers: Record<string, string>): Promise<string> {
	const recommendationsUrl = new URL(`${apiBase()}/v1/dish-categories/recommendations`);
	recommendationsUrl.searchParams.set("address", SEED_ADDRESS);
	recommendationsUrl.searchParams.set("languageTag", "ja-JP");
	recommendationsUrl.searchParams.set("localLanguageCode", "ja");

	const recommendations = await request.get(recommendationsUrl.toString(), { headers });
	if (!recommendations.ok()) {
		throw new Error(`料理カテゴリの推薦取得に失敗しました: ${recommendations.status()}`);
	}
	const recommendationsBody = (await recommendations.json()) as { data?: { categoryId?: string }[] };
	const categoryIds = (recommendationsBody.data ?? [])
		.map((item) => item.categoryId)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
		.slice(0, 5);

	const tried: string[] = [];
	for (const categoryId of categoryIds) {
		const searchUrl = new URL(`${apiBase()}/v1/dish-media/search`);
		searchUrl.searchParams.set("location", SEARCH_LOCATION);
		searchUrl.searchParams.set("radius", String(SEARCH_RADIUS));
		searchUrl.searchParams.set("categoryId", categoryId);
		searchUrl.searchParams.set("limit", "1");

		const response = await request.get(searchUrl.toString(), { headers });
		if (!response.ok()) {
			tried.push(`${categoryId}: status=${response.status()}`);
			continue;
		}
		const id = extractFirstDishMediaId(await response.json());
		if (id) return id;
		tried.push(`${categoryId}: 0 件`);
	}

	throw new Error(
		[
			"共有リンクの対象にできる dish_media が見つかりませんでした（前提条件の不足であってバグではない）。",
			`  検索: location=${SEARCH_LOCATION} radius=${SEARCH_RADIUS}`,
			...tried.map((line) => `  - ${line}`),
		].join("\n"),
	);
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
	//
	// ⚠️ `GET /v1/dish-media?limit=1` を使わないこと。**必ず 400 になる**。
	// あちらは «ids 指定の取得» 専用で `QueryDishMediaByIdsDto.ids` が必須（api の dish-media.controller）。
	// 一覧は `GET /v1/dish-media/search` で、`location` / `radius` / `categoryId` が必須。
	// 実際 e2e-mobile 側で同じ呼び方をして 400 を踏んだ（run 31489515281）。
	//
	// `categoryId` は `dish_categories` が RLS ポリシー未定義で supabase から読めないため、
	// 推薦 API（アプリの検索画面と同じ経路）から取る。カテゴリによっては 0 件になりうるので
	// 上位いくつかを順に試す。
	const dishMediaId = await findAnyDishMediaId(request, headers);
	const createResponse = await request.post(`${apiBase()}/v1/share-links`, {
		headers,
		data: { target: { type: "dish_media", params: { ids: [dishMediaId] } }, locale: "ja-JP" },
	});
	if (!createResponse.ok()) {
		throw new Error(`共有リンクの作成に失敗しました: ${createResponse.status()} ${await createResponse.text()}`);
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
