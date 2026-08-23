import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import type { MyDishItem, QueryMyDishesResponse } from "@shared/api/v1/res";

/**
 * 🍽 #1398 (PR7/7) 「食べたライフサイクル」の E2E 用ユーティリティ
 *
 * ## 何のためにあるか
 *
 * この Issue で固定したい 4 件（+ Q2）は、どれも **実データが要る**。
 *
 * - 食べたい → 食べた: 事前に `reactions(save)` が付いた `dish_media` が要る
 * - 写真なし記録   : 実在する `restaurants.id` が要る（`/restaurant/[id]/review` へ着地するため）
 * - 全画面 Feed    : `dish_media` を 1 件以上持つ実在の店舗が要る
 *
 * 画面操作だけで前提を作ると、検索タブの AI 推薦（`tests/authenticated/reactions.spec.ts` が
 * 90 秒のタイムアウトとリトライ 2 回を積んでいる経路）に依存することになり、
 * **本題と無関係な理由で落ちる**。そこで «前提は API で作り、検証は画面で行う» に分ける。
 *
 * ⚠️ **ID をハードコードしないこと。** dev DB の中身は入れ替わるため、固定 ID は
 * 「ある日突然 404 で落ちる」テストになる（`utils/shareLinks.ts` と同じ方針）。
 *
 * ⚠️ **Google Places Text Search / Autocomplete は呼ばない**（#1375 設計の正本 §5）。
 * 店舗は自前 `restaurants` テーブルの `GET /v1/restaurants/search` からだけ拾う。
 */

/**
 * API のベース URL。ビルド時に app へ焼き込まれるものと同じ値を使う。
 *
 * ⚠️ 読み込みは **呼び出し時**に行う。`playwright.config.ts` が読むのは `e2e-web/.env` だけで、
 * バックエンドの URL は `app-expo/.env`（eas env:pull の取得先）にある。しかも Playwright の
 * worker は別プロセスなので、setup プロジェクトが読んだ値は伝播しない
 *（`utils/testUserSession.ts` が同じ理由で自分で dotenv を読んでいる）。
 */
export function apiBase(): string {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });

	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。e2e-web/.env に設定するか、eas-cli env:pull を実行してください。",
		);
	}
	return base.replace(/\/+$/, "");
}

/** 検索の中心。dev にデータが集まっている都心を固定で使う（東京駅。`utils/shareLinks.ts` と同じ） */
const SEARCH_LAT = 35.681236;
const SEARCH_LNG = 139.767125;
/** 検索半径 (m)。狭いと 0 件、広すぎても API が重くなるだけ */
const SEARCH_RADIUS = 20000;

/** ブラウザの localStorage から Supabase の access_token を取り出す（`utils/shareLinks.ts` と同じ作法） */
export async function readAccessToken(page: Page): Promise<string> {
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
	if (!token) throw new Error("Supabase の access_token を取得できませんでした（セッション未確立）");
	return token;
}

/**
 * 前提づくり用のリクエストヘッダー。
 *
 * `x-app-version`（アプリは `app-expo/lib/fetchWithAuth.ts` で全リクエストに付ける）は
 * 付けない。付けなくても API は通り、既存の `utils/shareLinks.ts` も同じ形だからである。
 * ここで «アプリと同じ» を装うと、バージョンを上げるたびに E2E のヘルパを直すことになる。
 */
export async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
	const accessToken = await readAccessToken(page);
	return {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"x-app-language": "ja-JP",
	};
}

/** `BaseResponse<T>` の封筒（`{ success, data }`）から `data` を取り出す */
function unwrap<T>(body: unknown): T {
	return (body as { data: T }).data;
}

/** 店舗 1 件ぶんの探索結果 */
export type DishMediaCandidate = {
	restaurantId: string;
	restaurantName: string;
	dishId: string;
	dishMediaId: string;
	dishName: string | null;
};

/**
 * 実在する店舗を 1 件返す（`dish_media` の有無は問わない）。
 *
 * 写真なし記録（`/restaurant/[id]/review`）は店舗さえあれば成立するので、
 * メディアを持つ店舗に絞る `findDishMediaCandidates` より当たりやすいこちらを使う。
 */
export async function findAnyRestaurant(
	request: APIRequestContext,
	headers: Record<string, string>,
): Promise<{ restaurantId: string; restaurantName: string }> {
	const url = new URL(`${apiBase()}/v1/restaurants/search`);
	url.searchParams.set("lat", String(SEARCH_LAT));
	url.searchParams.set("lng", String(SEARCH_LNG));
	url.searchParams.set("radius", String(SEARCH_RADIUS));
	url.searchParams.set("limit", "20");

	const response = await request.get(url.toString(), { headers });
	if (!response.ok()) {
		throw new Error(`店舗検索に失敗しました: ${response.status()} ${await response.text()}`);
	}
	// QueryRestaurantsResponse は `{ restaurant, meta }` の配列
	const items = unwrap<{ restaurant: { id: string; name: string | null } }[]>(await response.json());
	const first = items?.[0];
	if (!first) {
		throw new Error(
			`dev DB の ${SEARCH_LAT},${SEARCH_LNG} 半径 ${SEARCH_RADIUS}m に店舗が 1 件もありません（前提条件の不足であってバグではない）`,
		);
	}
	return { restaurantId: first.restaurant.id, restaurantName: first.restaurant.name ?? "" };
}

/**
 * `dish_media` を持つ店舗を探し、その先頭メディアを候補として返す。
 *
 * `GET /v1/dish-media/search` は `categoryId` が必須で、カテゴリは推薦 API（AI）からしか
 * 引けない（`utils/shareLinks.ts` のコメント参照）。ここでは AI を通したくないので
 * 「自前テーブルの店舗検索 → 店舗の料理一覧」の 2 段で拾う。
 *
 * @param limit 返す候補の最大件数（先頭から順に「使えるもの」を試すため複数返す）
 */
export async function findDishMediaCandidates(
	request: APIRequestContext,
	headers: Record<string, string>,
	limit = 5,
): Promise<DishMediaCandidate[]> {
	const url = new URL(`${apiBase()}/v1/restaurants/search`);
	url.searchParams.set("lat", String(SEARCH_LAT));
	url.searchParams.set("lng", String(SEARCH_LNG));
	url.searchParams.set("radius", String(SEARCH_RADIUS));
	url.searchParams.set("limit", "40");

	const response = await request.get(url.toString(), { headers });
	if (!response.ok()) {
		throw new Error(`店舗検索に失敗しました: ${response.status()} ${await response.text()}`);
	}
	const restaurants = unwrap<{ restaurant: { id: string; name: string | null } }[]>(await response.json()) ?? [];

	const candidates: DishMediaCandidate[] = [];
	for (const { restaurant } of restaurants) {
		if (candidates.length >= limit) break;
		const mediaResponse = await request.get(`${apiBase()}/v1/restaurants/${restaurant.id}/dish-media`, { headers });
		if (!mediaResponse.ok()) continue;
		// QueryRestaurantDishMediaResponse は PaginatedResponse なので `data.data`
		const page = unwrap<{ data?: DishMediaEntryLike[] }>(await mediaResponse.json());
		const entry = page?.data?.[0];
		if (!entry) continue;
		candidates.push({
			restaurantId: restaurant.id,
			restaurantName: restaurant.name ?? "",
			dishId: entry.dish.id,
			dishMediaId: String(entry.dish_media.id),
			dishName: entry.dish.name ?? null,
		});
	}

	if (candidates.length === 0) {
		throw new Error(
			`dish_media を持つ店舗が dev DB に見つかりませんでした（前提条件の不足であってバグではない）: lat=${SEARCH_LAT} lng=${SEARCH_LNG} radius=${SEARCH_RADIUS}`,
		);
	}
	return candidates;
}

/** `GET /v1/restaurants/:id/dish-media` の 1 件から、このユーティリティが読む分だけ */
type DishMediaEntryLike = {
	dish: { id: string; name: string | null };
	dish_media: { id: string };
};

/** 「食べたい」を付ける（`POST /v1/dish-media/:id/reaction { action_type: "save" }`） */
export async function saveDishMedia(
	request: APIRequestContext,
	headers: Record<string, string>,
	dishMediaId: string,
): Promise<void> {
	const response = await request.post(`${apiBase()}/v1/dish-media/${dishMediaId}/reaction`, {
		headers,
		data: { action_type: "save" },
	});
	if (!response.ok()) {
		throw new Error(`食べたい登録に失敗しました: ${response.status()} ${await response.text()}`);
	}
}

/** 「食べたい」を外す（後始末用。失敗しても投げない＝本題の失敗を上書きしないため） */
export async function unsaveDishMediaQuietly(
	request: APIRequestContext,
	headers: Record<string, string>,
	dishMediaId: string,
): Promise<void> {
	try {
		await request.delete(`${apiBase()}/v1/dish-media/${dishMediaId}/reaction?action_type=save`, { headers });
	} catch {
		// 後始末は best-effort。`tests/authenticated/reactions.spec.ts` と同じ扱い
	}
}

/** `GET /v1/users/me/dishes` を直接叩く（前提づくり・後片付けの確認用） */
export async function fetchMyDishes(
	request: APIRequestContext,
	headers: Record<string, string>,
	params: Record<string, string> = {},
): Promise<{ status: number; items: MyDishItem[] }> {
	const url = new URL(`${apiBase()}/v1/users/me/dishes`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	const response = await request.get(url.toString(), { headers, failOnStatusCode: false });
	if (!response.ok()) return { status: response.status(), items: [] };
	const body = unwrap<QueryMyDishesResponse>(await response.json());
	return { status: response.status(), items: body?.data ?? [] };
}

/**
 * ✋ 前提チェック 1: `GET /v1/users/me/dishes` が **デプロイ済みか**。
 *
 * この endpoint は #1395 / #1396 で追加されたが、`api-development`（Cloud Run）は
 * 手動デプロイ（`.github/workflows/api-deploy.yml` の `workflow_dispatch`）なので、
 * 統合ブランチのコードが入っているとは限らない。未デプロイだと 404 になる。
 *
 * **これはアプリの不具合ではなく実行環境のズレ**なので、テストは赤ではなく
 * 「理由の分かる skip」にする（環境変数未設定時の `test.skip` と同じ扱い）。
 */
export async function isMyDishesApiAvailable(
	request: APIRequestContext,
	headers: Record<string, string>,
): Promise<boolean> {
	const { status } = await fetchMyDishes(request, headers, { limit: "1" });
	return status === 200;
}

/**
 * ✋ 前提チェック 2: `POST /v1/dish-reviews` が **写真なし（`createdDishMediaId` 省略）を受けるか**。
 *
 * `CreateDishReviewDto.createdDishMediaId` は #1395 で任意になったが、デプロイ済みの
 * `api-development` が古いと `@IsUUID()` の必須のままで、省略すると
 * `400 VALIDATION_ERROR: createdDishMediaId must be a UUID` になる。
 *
 * ## なぜ «存在しない dishId» で試すのか
 *
 * バリデーションは **DB へ書く前** に走る。実在しない dish の UUID を渡せば、
 * - 古い API: `createdDishMediaId must be a UUID` を含む 400（＝写真なし不可）
 * - 新しい API: `dishId` は形式として正しいのでバリデーションを通過し、
 *   その先（dish が無い）で落ちる ＝ 上のメッセージは出ない
 * となり、**dev DB を 1 行も汚さずに** 判定できる。
 */
export async function isNoMediaReviewSupported(
	request: APIRequestContext,
	headers: Record<string, string>,
): Promise<{ supported: boolean; detail: string }> {
	const response = await request.post(`${apiBase()}/v1/dish-reviews`, {
		headers,
		failOnStatusCode: false,
		data: {
			// 実在しない dish（形式は正しい UUID）。バリデーションだけを見たいので書き込みには至らない
			dishId: "00000000-0000-4000-8000-000000001398",
			comment: "[E2E] #1398 PR7 前提チェック（書き込みには至らない）",
			languageCode: "ja",
			priceCents: 100,
			currencyCode: "JPY",
			rating: 3,
		},
	});
	const text = await response.text();
	const rejectedForMissingMediaId = text.includes("createdDishMediaId");
	return {
		supported: !rejectedForMissingMediaId,
		detail: `status=${response.status()} body=${text.slice(0, 200)}`,
	};
}

/** `GET /v1/users/me/dishes`（map-pins は除く）のレスポンスか */
export function isMyDishesListResponseUrl(url: string): boolean {
	return /\/v1\/users\/me\/dishes(\?|$)/.test(url);
}

/** レスポンス本文（`BaseResponse` の封筒付き）から `MyDishItem[]` を取り出す */
export function readMyDishItems(body: unknown): MyDishItem[] {
	const page = unwrap<QueryMyDishesResponse>(body);
	return page?.data ?? [];
}

/**
 * 写真ピッカーを **キャンセル** する。
 *
 * web の `expo-image-picker` は `<input type="file" data-testid="file-input">` を作って
 * click し、`change` で 0 件なら「キャンセル」と解釈する
 *（`expo-image-picker/build/ExponentImagePicker.web.js`）。
 * Playwright の `fileChooser.setFiles([])` はこの input に 0 件をセットして `change` を撃つので、
 * **ユーザーがダイアログを閉じたのと同じ経路** になる。
 */
export async function cancelMediaPicker(page: Page, fileChooser: { setFiles: (files: string[]) => Promise<void> }) {
	await fileChooser.setFiles([]);
	// 保険: 何らかの理由で change が届かなかったときのために、input の `cancel` も撃つ。
	// （`cancel` → `change`（0 件）→ `canceled: true` と同じ経路に入る）
	const input = page.locator('input[data-testid="file-input"]');
	if ((await input.count()) > 0) {
		await input
			.first()
			.dispatchEvent("cancel")
			.catch(() => undefined);
	}
}

/**
 * レビューを投稿し、`POST /v1/dish-reviews` の応答を返す。
 *
 * ## なぜ «スナックバーを待つ» だけにしないのか
 *
 * 1. **投稿ボタンが活性になるのを待つ**必要がある。`isValid` は ★・コメント・価格・カテゴリが
 *    揃って初めて true になり、直前の入力の再描画が終わる前に押すと
 *    `TouchableOpacity disabled` を押すことになって **何も起きない**。
 *    実際、この待ちが無い版は 1 回目の実行で «スナックバーが出ない» と落ちた。
 * 2. **落ちたときに原因が分かる**。スナックバーだけを見ていると、API が 400 を返しても
 *    「要素が見つからない」としか出ない。応答を掴んでおけば PR へ実測値をそのまま書ける。
 */
export async function submitReviewForm(page: Page): Promise<{ status: number; body: string }> {
	const submitButton = page.getByTestId("review-submit-button");
	await expect(submitButton).toBeEnabled({ timeout: 15_000 });

	const responsePromise = page.waitForResponse(
		(response) => /\/v1\/dish-reviews(\?|$)/.test(response.url()) && response.request().method() === "POST",
		{ timeout: 60_000 },
	);
	await submitButton.click();
	const response = await responsePromise;
	return { status: response.status(), body: (await response.text()).slice(0, 300) };
}

/**
 * 📸 証跡スクリーンショットを撮る。
 *
 * ## なぜテスト側で明示的に撮るのか
 *
 * `playwright.config.ts` の `screenshot: "only-on-failure"` は **落ちた時しか撮らない**。
 * この Issue の完了条件は「通っていること」を人が見て確認できることなので、
 * 成功時の画面こそ残す必要がある（PW_FORCE_VISUALS に頼ると全 spec が重くなる）。
 *
 * - 常に HTML レポートへ添付する（`testInfo.attach`）
 * - `E2E_EVIDENCE_DIR` が指定されていれば、そこにも `<spec>-<name>.png` で書き出す
 *   （PR / Issue へ貼るためにファイルとして取り出したいときに使う）
 */
export async function captureEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	const buffer = await page.screenshot({ fullPage: false });
	await testInfo.attach(`${name}.png`, { body: buffer, contentType: "image/png" });

	const dir = process.env.E2E_EVIDENCE_DIR;
	if (!dir) return;
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${name}.png`), buffer);
}

/** レビュー本文。dev DB に残るので `[E2E]` プレフィックスで識別できるようにする（既存 spec と同じ作法） */
export function e2eReviewComment(label: string): string {
	return `[E2E] #1398 ${label} ${new Date().toISOString()}`.slice(0, 100);
}
