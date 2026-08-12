import * as path from "node:path";

import * as dotenv from "dotenv";

import { fetchDishCategoryIds } from "./savedDishCategory";
import { ensureFreshSession } from "./freshSession";

/**
 * 🔗 Detox から «実在する共有リンク» を 1 本作る（#721）
 *
 * ## なぜ実在するリンクが要るのか（2 度 CI を赤くして辿り着いた）
 * 「`/s/:token` がディープリンクとして捨てられていないこと」を見たいのだが、
 * **解決に失敗するトークンでは «捨てられた» と «受け取って解決に失敗した» を区別できない**。
 * どちらも最終的にホームへ着地するからである。
 *
 * 当初は途中に一瞬出る解決画面（`share-link-resolver`）を観測して区別していたが、
 * あの画面は resolve の往復の間しか存在せず、実測で往復は数秒。
 * Detox は「アプリが idle になってから」matcher を評価するため、
 * **原理的に取り逃がす**（実際に 25 秒待って 2 回落ちた）。
 *
 * 実在するリンクなら着地先が変わる:
 * - 捨てられた → ホーム（検索タブ）
 * - 受け取れた → 投稿画面（`posts-screen`）
 *
 * これは過渡状態ではなく **留まる状態**なので、待てば必ず観測できる。
 *
 * ## 書き込みについて
 * `POST /v1/share-links` は dev DB へ 1 行 append する。
 * e2e-web の `tests/share/share-link-ogp.spec.ts` も同じことをしており
 * （`e2e-web/utils/shareLinks.ts`）、共有リンクは **API 経由でしか作れない**
 * （`preview_title` / `preview_image_path` をサーバ側 Resolver が作るため、
 *  DB を直接いじる代替がない）。他のテストと共有する状態は作らないので tier は据え置く。
 *
 * ## セキュリティ
 * トークン（Supabase / 共有リンクとも）は **ログへ出さない**。
 */

/** 環境変数から API のベース URL を読む。app へ焼き込まれるものと同じ値 */
function apiBase(): string {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });

	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			[
				"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。",
				"  ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
			].join("\n"),
		);
	}
	return base.replace(/\/+$/, "");
}

/** 検索の中心。dev にデータが集まっている都心を固定で使う（東京駅） */
const SEARCH_LOCATION = "35.681236,139.767125";
/** 検索半径 (m)。狭すぎると 0 件になり、広すぎても API が重くなるだけ */
const SEARCH_RADIUS = 5000;

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

/**
 * 実在する dish_media を 1 件探す。
 *
 * ⚠️ `GET /v1/dish-media` は **ids 指定の取得専用**で、`limit` だけ渡すと 400 になる
 * （`QueryDishMediaByIdsDto.ids` が必須。e2e-web/utils/shareLinks.ts はここを間違えている）。
 * 一覧は `GET /v1/dish-media/search` で、`location` / `radius` / `categoryId` が必須。
 *
 * カテゴリによっては 0 件のことがあるので、推薦の上位いくつかを順に試す。
 */
async function findAnyDishMediaId(base: string, headers: Record<string, string>, accessToken: string): Promise<string> {
	const categoryIds = await fetchDishCategoryIds(accessToken, 5);
	const tried: string[] = [];

	for (const categoryId of categoryIds) {
		const url = new URL(`${base}/v1/dish-media/search`);
		url.searchParams.set("location", SEARCH_LOCATION);
		url.searchParams.set("radius", String(SEARCH_RADIUS));
		url.searchParams.set("categoryId", categoryId);
		url.searchParams.set("limit", "1");

		const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(60_000) });
		if (!response.ok) {
			tried.push(`${categoryId}: status=${response.status}`);
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
 * 固定 ID は「ある日突然 404 で落ちる」テストになる。
 *
 * @returns 作成した共有リンクの token
 * @失敗時 日本語メッセージで例外を投げる（fail-loud）
 */
export async function createShareLinkToken(): Promise<string> {
	// 鮮度保証つきで読む（実測 401: 料理カテゴリの推薦取得に失敗しました（status=401） @ 確立の 80 分後）
	const session = await ensureFreshSession("anon");
	if (!session) {
		throw new Error("匿名セッションが確立されていません（fixtures/globalSetup.ts を確認してください）。");
	}

	const base = apiBase();
	const headers = {
		Authorization: `Bearer ${session.accessToken}`,
		"Content-Type": "application/json",
	};

	const dishMediaId = await findAnyDishMediaId(base, headers, session.accessToken);

	const createResponse = await fetch(`${base}/v1/share-links`, {
		method: "POST",
		headers,
		body: JSON.stringify({ target: { type: "dish_media", params: { ids: [dishMediaId] } }, locale: "ja-JP" }),
		signal: AbortSignal.timeout(60_000),
	});
	if (!createResponse.ok) {
		throw new Error(`共有リンクの作成に失敗しました: status=${createResponse.status}`);
	}

	const created = (await createResponse.json()) as { data?: { token?: string } };
	const token = created.data?.token;
	if (!token) throw new Error("共有リンクの作成レスポンスに token がありません。");

	return token;
}
