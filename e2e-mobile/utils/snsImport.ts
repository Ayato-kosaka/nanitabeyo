/**
 * 📥 SNS 取り込み（#1375 / #1399）を **Node 側から実 API で実行する**ヘルパ。
 *
 * ## なぜ UI ではなく API から入れるのか
 *
 * オーナー実機指摘「インスタをインポートして食べたいを押したら、メディアと料理が出ない」を
 * 再現するのに要るのは «取り込まれた 1 行が一覧でどう見えるか» であって、取り込み画面の操作
 * ではない。UI から入れると **店舗候補が返るかどうか（外部依存）** で結果が揺れ、
 * 「実装が壊れたのか候補が出なかったのか」を区別できないテストになる。
 *
 * ⚠️ ここは **dev DB へ書く**（`@mutation`）。取り込みはサービス側が冪等で、
 * 2 回目以降に増えるのは «テストユーザーの食べたい» 1 件だけである。
 */
import * as path from "node:path";

import * as dotenv from "dotenv";

/** 取り込みに使う実在の Instagram リール。**実在しないと resolve が unsupported を返す** */
export const IMPORT_REEL_URL = "https://www.instagram.com/reel/DZnIRziT70s/";

/** 店舗候補を探すエリア（東京駅周辺）。resolve は lat/lng/radius が揃ったときだけ店舗候補を返す */
const AREA = { lat: 35.6812, lng: 139.7671, radius: 50_000 };

function backendBaseUrl(): string {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });
	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) throw new Error("EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。");
	return base;
}

async function callApi<T>(accessToken: string, pathname: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${backendBaseUrl()}${pathname}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(60_000),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`API ${pathname} が ${response.status} を返しました: ${text.slice(0, 400)}`);
	}
	// BaseResponse の封筒 `{ success, data }` を剥がす
	const body = JSON.parse(text) as { data?: T };
	return body.data as T;
}

/** 一覧の 1 行から «画面に出る料理名» を決める（アプリ側 `resolveMyDishTitle` と同じ規則） */
export function titleOfWantRow(
	row: {
		dish: { name: string | null; categoryLabels?: Record<string, string> | null };
		restaurant: { name: string | null };
	},
	lang = "ja",
): string {
	const labels = row.dish.categoryLabels ?? undefined;
	return labels?.[lang] || labels?.en || row.dish.name || row.restaurant.name || "";
}

export type ResolvedImport = {
	status: string;
	source: { provider: string | null; externalContentId: string | null; canonicalUrl: string | null } | null;
	candidates: {
		dishCategories: { dishCategoryId: string }[];
		restaurants: { restaurantId: string }[];
	};
	prefill: { dishCategoryId: string | null; restaurantId: string | null };
};

/** 「読み取る」に相当（DB へは 1 行も書かない） */
export async function resolveImport(accessToken: string): Promise<ResolvedImport> {
	return callApi<ResolvedImport>(accessToken, "/v1/dish-media/imports/resolve", {
		method: "POST",
		body: JSON.stringify({ url: IMPORT_REEL_URL, ...AREA, limit: 5 }),
	});
}

/** 「食べたいに保存」に相当（`dishes` / `dish_media` / `reactions(save)` を書く） */
export async function createImport(
	accessToken: string,
	params: { restaurantId: string; dishCategoryId: string },
): Promise<{ dishMediaId: string; dishId: string; created: boolean; saved: boolean }> {
	return callApi(accessToken, "/v1/dish-media/imports", {
		method: "POST",
		body: JSON.stringify({ url: IMPORT_REEL_URL, ...params }),
	});
}

/** 一覧（`GET /v1/users/me/dishes`）を «食べたい» で引く。アプリが描くのと同じ形が返る */
export async function fetchMyWantDishes(accessToken: string): Promise<{
	data: {
		key: string;
		status: string;
		dish: {
			id: string;
			category_id: string;
			name: string | null;
			categoryImageUrl: string | null;
			categoryLabels?: Record<string, string> | null;
		};
		dishMedia: { id: string; thumbnailImageUrl: string | null; render_type?: string } | null;
		restaurant: { id: string; name: string | null };
	}[];
}> {
	return callApi(accessToken, "/v1/users/me/dishes?statuses=want&limit=42");
}

/** 店舗候補が無かったときの逃げ道。店名検索から 1 件取る */
export async function anyRestaurantId(accessToken: string): Promise<string | null> {
	const results = await callApi<{ restaurant: { id: string } }[]>(
		accessToken,
		`/v1/restaurants/search?lat=${AREA.lat}&lng=${AREA.lng}&radius=2000&limit=1`,
	);
	return results?.[0]?.restaurant?.id ?? null;
}
