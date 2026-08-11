import * as path from "node:path";

import * as dotenv from "dotenv";

import { readSessionFromEnv } from "./sessionEnv";

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

/**
 * 検索レスポンスから dish_media の ID を 1 件取り出す。
 *
 * レスポンス形（`data.data[].dish_media.id` か `data[].id` か）は API の版で揺れるので、
 * どちらでも拾えるようにしておく。ここで固定すると、無関係な API 変更でこの spec が落ちる
 * （e2e-web/utils/shareLinks.ts と同じ判断。写しであることを承知で置いている）。
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
 * 実在する dish_media を 1 件拾って共有リンクを作る。
 *
 * ⚠️ ID を固定値でハードコードしないこと。dev DB の中身は入れ替わるため、
 * 固定 ID は「ある日突然 404 で落ちる」テストになる。
 *
 * @returns 作成した共有リンクの token
 * @失敗時 日本語メッセージで例外を投げる（fail-loud）
 */
export async function createShareLinkToken(): Promise<string> {
	const session = readSessionFromEnv("anon");
	if (!session) {
		throw new Error("匿名セッションが確立されていません（fixtures/globalSetup.ts を確認してください）。");
	}

	const base = apiBase();
	const headers = {
		Authorization: `Bearer ${session.accessToken}`,
		"Content-Type": "application/json",
	};

	const searchResponse = await fetch(`${base}/v1/dish-media?limit=1`, {
		method: "GET",
		headers,
		signal: AbortSignal.timeout(60_000),
	});
	if (!searchResponse.ok) {
		throw new Error(`dish_media の取得に失敗しました: status=${searchResponse.status}`);
	}
	const dishMediaId = extractFirstDishMediaId(await searchResponse.json());
	if (!dishMediaId) {
		throw new Error("dev の dish_media が 0 件のため共有リンクを作れません（前提条件の不足であってバグではない）。");
	}

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
