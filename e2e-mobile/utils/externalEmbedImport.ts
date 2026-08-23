import * as path from "node:path";

import * as dotenv from "dotenv";

/**
 * 🎞️ SNS 取り込み（external_embed）のテストデータを dev API 経由で用意する（#1375）
 *
 * ## 何をするか
 * `POST /v1/dish-media/imports/resolve` で URL を解決し、候補の先頭
 * （店舗 / 料理カテゴリ）で `POST /v1/dish-media/imports` を叩いて
 * **テストユーザーの「食べたい」として保存**する。
 *
 * ## 何度呼んでも安全な理由
 * create はサービス側が冪等に作られている（dish-media-imports.service.ts）:
 * 既に同じ (provider, external_content_id, dish) の行があれば **新しい行は作らず**、
 * `reactions(save)` だけを呼び出しユーザーの分だけ必ず用意する。
 * つまり 2 回目以降の実行は「テストユーザーの食べたいを保証する」だけの読み等価になる。
 *
 * ## なぜ座標を渡さないのか
 * この URL のキャプションには「📍 住所：…」が入っており、サーバが国土地理院 API で
 * ジオコーディングして店舗候補を返す（#1375 4 巡目で実測済みの経路）。
 * 座標を渡さないことで、その経路自体もテストで通ることになる。
 */

/** キャプションに住所が入っており、座標なしで店舗候補が出ることを実測済みのリール（#1375） */
export const EXTERNAL_EMBED_IMPORT_URL = "https://www.instagram.com/reel/DZFdePPzzLI/";

type ResolveResponse = {
	data?: {
		candidates?: {
			dishCategories?: { dishCategoryId?: string }[];
			restaurants?: { restaurantId?: string }[];
		};
		prefill?: { dishCategoryId?: string | null; restaurantId?: string | null };
	};
};

function backendBaseUrl(): string {
	// globalSetup が読み込み済みだが、ワーカー単独起動でも動くよう同じ 2 ファイルを読む
	// （dotenv は既存値を上書きしないため CI の secrets が常に優先される。savedDishCategory.ts と同じ）
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });
	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
		);
	}
	return base;
}

/**
 * external_embed の記録がテストユーザーの「食べたい」に存在する状態を保証し、
 * 保存先の restaurantId を返す（spec はこれでお店フィードへ deep link する）。
 *
 * @param accessToken 認証済みテストユーザーの access token（E2E_AUTH_ACCESS_TOKEN）
 */
export async function ensureExternalEmbedImported(accessToken: string): Promise<{ restaurantId: string }> {
	const base = backendBaseUrl();
	const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

	// resolve は Instagram の embed ページ取得（サーバ側）+ ジオコーディングを挟むため長めに待つ
	const resolveResponse = await fetch(`${base}/v1/dish-media/imports/resolve`, {
		method: "POST",
		headers,
		body: JSON.stringify({ url: EXTERNAL_EMBED_IMPORT_URL }),
		signal: AbortSignal.timeout(90_000),
	});
	if (!resolveResponse.ok) {
		throw new Error(`SNS 取り込みの resolve に失敗しました（status=${resolveResponse.status}）`);
	}
	const resolved = (await resolveResponse.json()) as ResolveResponse;
	const candidates = resolved.data?.candidates;
	const restaurantId = resolved.data?.prefill?.restaurantId ?? candidates?.restaurants?.[0]?.restaurantId;
	const dishCategoryId = resolved.data?.prefill?.dishCategoryId ?? candidates?.dishCategories?.[0]?.dishCategoryId;
	if (!restaurantId || !dishCategoryId) {
		throw new Error(
			`resolve は成功したが候補が空です（restaurantId=${String(restaurantId)}, dishCategoryId=${String(dishCategoryId)}）。` +
				" キャプション住所→国土地理院ジオコーディング→店舗照合の経路が壊れていないか確認してください。",
		);
	}

	const createResponse = await fetch(`${base}/v1/dish-media/imports`, {
		method: "POST",
		headers,
		body: JSON.stringify({ url: EXTERNAL_EMBED_IMPORT_URL, restaurantId, dishCategoryId }),
		signal: AbortSignal.timeout(90_000),
	});
	if (!createResponse.ok) {
		throw new Error(`SNS 取り込みの create に失敗しました（status=${createResponse.status}）`);
	}

	return { restaurantId };
}
