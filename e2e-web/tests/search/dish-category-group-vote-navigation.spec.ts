import type { Page, Route } from "@playwright/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { test, expect } from "../../fixtures/test";
import { waitForAnonymousSession } from "../../utils/auth";
import { ResultPage } from "../../pages/ResultPage";

/**
 * 🗳 友達投票の結果画面 →「店を見る」導線 (#1122 の回帰テスト)
 *
 * ## 背景 (#1122 / 修正 PR #1158)
 * 候補の詳細モーダル（当時は `useBlurModal` = react-native-paper の `Portal` 配下）を開いたまま
 * `router.push` で DishMediaMap（`/[locale]/search/result`）へ遷移すると、`Portal` は
 * `Portal.Host` 直下（= Stack より上のレイヤー）に描かれるため、遷移先の画面の上に
 * バックドロップ（`StyleSheet.absoluteFill` の `Pressable`）が残り続け、**遷移先を一切
 * タップできない**状態になっていた（web / Android で再現。iOS は遷移先が
 * `presentation: "transparentModal"` で Portal より上に載るため無事）。
 *
 * PR #1158 は「モーダルのクローズ完了を待ってから遷移する」順序へ直した。
 * この spec はその順序を **ブラウザ上の実挙動**（＝遷移先が実際にクリックできること）で固定する。
 *
 * ## #1358 でのレイヤー構造の変更（この spec の前提が変わった点）
 * 詳細モーダルは `Portal` をやめ、結果画面の子として描くインラインレイヤー
 * （`app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteInlineOverlay.tsx`）へ移した。
 * `Portal.Host` は画面スタックの外側にあり、そこへレイヤーを積むこと自体が #1122 の根本原因だったので、
 * 画面の内側へ戻したことで遷移先がレイヤーごと上から覆う ＝ 構造として再発しない。
 *
 * それでも本 spec は残す（弱めない）。理由:
 * - 「閉じてから遷移する」順序は #1358 後も仕様として維持している（web は遷移しても前画面の DOM が
 *   残るため、開いたまま遷移してよいことにすると同じ経路が復活しうる）。
 * - 観測点は移行前後で不変。詳細本体は testID `dish-category-group-vote-candidate-detail`、
 *   閉じる導線は右上 X の accessibilityLabel（`Common.close`）。**e2e-mobile の Screen Object も
 *   同じ観測点を使っているので、どちらかを変えるときは必ず両方を直すこと。**
 *
 * ## この spec が API をモックする理由
 * 結果画面には有効な shareToken が要る。dev DB に固定の共有セッションを播く仕組みは無く、
 * 播いたとしても「未検索(not_searched)候補の検索が数秒かかる」という**タイミング**は
 * 実 API では制御できない。#1122 の潜在バグ（後述の 2 本目）は、まさにその待ち時間の
 * 割り込みで起きるため、`page.route()` で経路ごと差し替えて再現性を担保する。
 *
 * ⚠️ `utils/network.ts` は「リクエスト回数を数える用途では `fulfill()` を使うな」と書いているが、
 * それは実 API の応答をそのまま観測したい計測系の話。ここは**画面遷移の順序**が検証対象で、
 * バックエンドの実データには一切依存しないため、意図して全面モックにしている。
 * バックエンドは別オリジン（Cloud Run）なので、`fulfill()` の応答には CORS ヘッダを自前で付ける
 * （プリフライト `OPTIONS` は Playwright の route に載らず実サーバが応答する）。
 */

/** モックする共有セッションのトークン。実 DB のどのセッションとも衝突しない値にしてある */
const SHARE_TOKEN = "e2e-1122-share-token";
const SESSION_ID = "e2e-1122-session";
/** 検索済み（dishMediaSearchStatus: "found"）= 押したら即遷移する候補 */
const CANDIDATE_FOUND = "e2e-1122-candidate-found";
/** 未検索（"not_searched"）= 押すと dish-media 検索を挟んでから遷移する候補 */
const CANDIDATE_NOT_SEARCHED = "e2e-1122-candidate-not-searched";
/** 割り込み用のもう 1 つの候補（無関係な店へ飛んでいないかの判定に使う） */
const CANDIDATE_OTHER = "e2e-1122-candidate-other";

const RESULT_URL_PATTERN = /\/search\/result/;

/** `callBackend` は `BaseResponse<R>`（`{ success, data }`）を厳密にパースするため同じ封筒で返す */
async function fulfillJson(route: Route, data: unknown): Promise<void> {
	// バックエンドは別オリジンのため、モック応答にも CORS ヘッダが要る。
	//
	// ⚠️ **`access-control-allow-origin: "*"` は使えない。** `fetchWithAuth` は web で
	// `credentials: "include"` を付けるため、ブラウザがワイルドカードを拒否する:
	//   The value of the 'Access-Control-Allow-Origin' header in the response must not be
	//   the wildcard '*' when the request's credentials mode is 'include'.
	// リクエスト元 origin をそのまま返し、`access-control-allow-credentials` を付ける。
	// （`e2e-web/utils/network.ts` に同じ注意書きと実装がある）
	const origin = (await route.request().headerValue("origin")) ?? "*";
	await route.fulfill({
		status: 200,
		contentType: "application/json",
		headers: {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
		},
		body: JSON.stringify({ success: true, data }),
	});
}

/**
 * 遷移先のフィードが描けるだけの `DishMediaEntry` を 1 件作る。
 *
 * 画像は `example.invalid` を指すので読み込みは失敗するが、この spec が見るのは
 * 「結果画面へ着いて操作できること」なので描画さえ通ればよい。
 * 形は `shared/api/v1/res/dish-media.response.ts` の `DishMediaEntry`。
 */
function buildDishMediaEntry(dishMediaId: string) {
	const now = "2026-08-07T00:00:00.000Z";
	const image = "https://example.invalid/e2e-1122.jpg";
	return {
		restaurant: {
			id: "e2e-1122-restaurant",
			name: "E2E テスト店",
			name_language_code: "ja",
			image_url: image,
			image_path: image,
			google_place_id: "e2e-1122-place",
			created_at: now,
			latitude: 35.6812,
			longitude: 139.7671,
			location: null,
			address_components: null,
			plus_code: null,
		},
		dish: {
			id: "e2e-1122-dish",
			name: "E2E テスト料理",
			restaurant_id: "e2e-1122-restaurant",
			category_id: "e2e-1122-category",
			created_at: now,
			updated_at: now,
			lock_no: 1,
			reviewCount: 0,
			averageRating: 0,
		},
		dish_media: {
			id: dishMediaId,
			dish_id: "e2e-1122-dish",
			media_path: image,
			thumbnail_path: image,
			media_type: "image",
			user_id: "e2e-1122-user",
			lock_no: 1,
			created_at: now,
			updated_at: now,
			media_processing_status: "completed",
			thumbnail_processing_status: "completed",
			isSaved: false,
			isLiked: false,
			likeCount: 0,
			isMine: false,
			mediaUrl: image,
			thumbnailImageUrl: image,
			video_duration_ms: null,
		},
		dish_reviews: [],
	};
}

/** 任意のタイミングで解放できる門。未検索候補の「検索中」を再現するために使う */
function createGate(): { wait: Promise<void>; open: () => void } {
	let open!: () => void;
	const wait = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait, open };
}

type CandidateOverrides = {
	id: string;
	displayName: string;
	dishMediaSearchStatus: "not_searched" | "found";
	dishMediaIds: string[];
	displayOrder: number;
};

function buildCandidate({ id, displayName, dishMediaSearchStatus, dishMediaIds, displayOrder }: CandidateOverrides) {
	return {
		id,
		dishCategoryId: `${id}-category`,
		displayName,
		tagline: `${displayName}のタグライン`,
		imageUrl: "https://example.com/e2e-1122.jpg",
		dishMediaIds,
		dishMediaSearchStatus,
		displayOrder,
		deletedAt: null,
		likeCount: 1,
		dislikeCount: 0,
		rank: displayOrder,
		votes: [{ participantId: "e2e-1122-participant", displayName: "E2E", reaction: "like" }],
	};
}

/** GET /v1/dish-category-group-votes/:shareToken の応答 */
function buildDetail() {
	return {
		session: {
			id: SESSION_ID,
			shareToken: SHARE_TOKEN,
			hostUserId: "e2e-1122-host",
			searchContext: {
				location: { latitude: 35.658, longitude: 139.7016 },
				radius: 1000,
				priceLevels: [],
				localLanguageCode: "ja",
			},
			// isHost=false: 削除ボタンを描かない = 押し間違いの余地を減らす
			isHost: false,
			hasVoted: true,
			participantCount: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		candidates: [
			buildCandidate({
				id: CANDIDATE_FOUND,
				displayName: "E2E 検索済みカテゴリ",
				dishMediaSearchStatus: "found",
				dishMediaIds: ["e2e-1122-dish-media-found"],
				displayOrder: 1,
			}),
			buildCandidate({
				id: CANDIDATE_NOT_SEARCHED,
				displayName: "E2E 未検索カテゴリ",
				dishMediaSearchStatus: "not_searched",
				dishMediaIds: [],
				displayOrder: 2,
			}),
			buildCandidate({
				id: CANDIDATE_OTHER,
				displayName: "E2E 別候補カテゴリ",
				dishMediaSearchStatus: "found",
				dishMediaIds: ["e2e-1122-dish-media-other"],
				displayOrder: 3,
			}),
		],
		participants: [
			{ id: "e2e-1122-participant", displayName: "E2E", comment: null, createdAt: "2026-01-01T00:00:00.000Z" },
		],
	};
}

type MockOptions = {
	/**
	 * 未検索候補の dish-media 検索（GET /v1/dish-media/search）を保留させる門。
	 * 省略時は保留せず即応答する。
	 */
	searchGate?: { wait: Promise<void> };
};

/**
 * 結果画面が触るバックエンド呼び出しを丸ごと差し替える。
 * `page.goto` より前に呼ぶこと。
 */
async function mockVoteBackend(page: Page, options: MockOptions = {}): Promise<void> {
	// ⚠️ Playwright の route は「後から登録したものが優先」。
	// より具体的なパターンを後に登録すること（detail の glob に食われないようにする）。
	await page.route(`**/v1/dish-category-group-votes/${SHARE_TOKEN}*`, async (route) => {
		await fulfillJson(route, buildDetail());
	});

	// 未検索候補の検索本体。ここを保留すると「検索中」の窓が作れる。
	await page.route("**/v1/dish-media/search*", async (route) => {
		await options.searchGate?.wait;
		// createDishItemsForCategory は 1 件でも返れば bulk-import に進まず、
		// `item.dish_media.id` しか見ない。E2E に必要な最小形だけ返す。
		await fulfillJson(route, [
			{
				dish_media: { id: "e2e-1122-dish-media-searched" },
				restaurant: { google_place_id: "e2e-1122-place" },
			},
		]);
	});

	// 検索結果のキャッシュ（PATCH .../candidates/:id/dish-media）。
	// ここが "found" を返した時点で画面が遷移を要求する。
	await page.route("**/v1/dish-category-group-votes/*/candidates/*/dish-media*", async (route) => {
		const candidateId = new URL(route.request().url()).pathname.split("/candidates/")[1]?.split("/")[0] ?? "";
		await fulfillJson(route, {
			candidateId,
			dishMediaIds: ["e2e-1122-dish-media-searched"],
			dishMediaSearchStatus: "found",
			updated: true,
		});
	});

	// 遷移先（検索結果フィード）が id 指定で引く一覧。
	//
	// ⚠️ **形と中身の両方に条件がある。**
	//
	// 1. 形は `{ items, notFound }`（`QueryDishMediaByIdsResponse`）。配列で返すと
	//    `data.items` が undefined になり、フィードが 1 枚も描けない。
	//    `/v1/dish-media/search` は配列なので、**この 2 つを混同しないこと。**
	// 2. `items` を空にしない。0 件が確定すると `result.tsx` が
	//    「Google マップで開く」fallback ダイアログを出し、**結果画面そのものが開かない**。
	//
	// 本 spec の検証対象は中身ではなく「モーダルが閉じてから遷移して操作できること」だが、
	// フィードのカードが描けないと `result-close-button` まで到達しないので、
	// `DishMediaEntry` を欠けなく 1 件返す（`app-expo/data/searchMockData.ts` と同じ形）。
	await page.route("**/v1/dish-media?*", async (route) => {
		// ⚠️ **要求された id をそのまま返すこと。** 候補ごとに dishMediaIds が違う
		// （found / other / 検索後）ので、固定 id を返すとフィードのストアが
		// 「要求した id の entry が無い」状態になり 1 枚も描けない。
		const requested = (new URL(route.request().url()).searchParams.get("ids") ?? "")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean);
		const ids = requested.length > 0 ? requested : ["e2e-1122-dish-media-found"];
		await fulfillJson(route, { items: ids.map(buildDishMediaEntry), notFound: [] });
	});
}

/** 結果画面を開き、候補一覧が出るまで待つ */
async function openVoteResult(page: Page): Promise<void> {
	await page.goto(`/ja-JP/search/dish-category-group-votes/${SHARE_TOKEN}`);
	await waitForAnonymousSession(page);
	await expect(page.getByTestId(`dish-category-group-vote-candidate-${CANDIDATE_FOUND}`)).toBeVisible({
		timeout: 30_000,
	});
}

const candidateCard = (page: Page, id: string) => page.getByTestId(`dish-category-group-vote-candidate-${id}`);
const detailModal = (page: Page) => page.getByTestId("dish-category-group-vote-candidate-detail");
const detailViewRestaurants = (page: Page) => page.getByTestId("dish-category-group-vote-detail-dish-media");
/** 詳細レイヤー右上の X（accessibilityLabel は ja-JP の Common.close = 「閉じる」）。#1358 後も同じ */
const modalCloseButton = (page: Page) => page.getByRole("button", { name: "閉じる" });

test.describe("友達投票の結果画面から店舗画面への遷移 (#1122)", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: モーダルが閉じてから遷移し、遷移先をすぐ操作できる ─
	// 手順:
	//   1. 検索済み候補のカードを押して詳細モーダルを開く
	//   2. モーダル内の「店を見る」を押す
	//   3. 詳細モーダルが DOM から消えている(= 詳細レイヤーがアンマウント済み)ことを検証
	//   4. 結果画面(DishMediaMap)へ遷移していることを検証
	//   5. 結果画面の閉じるボタンを**実際にクリック**して、操作できることを検証
	//      → 修正前はモーダルのバックドロップが上に残るため、Playwright の
	//        actionability チェック(pointer-events を受け取れるか)で必ず失敗する
	test("モーダルが閉じてから店舗画面へ遷移し、すぐ操作できる", async ({ page }) => {
		await mockVoteBackend(page);
		await openVoteResult(page);

		await candidateCard(page, CANDIDATE_FOUND).click();
		await expect(detailModal(page)).toBeVisible();

		await detailViewRestaurants(page).click();

		// 「閉じてから遷移」の順序そのもの。遷移先に着いた時点でモーダルは残っていてはいけない
		await expect(detailModal(page)).toBeHidden();

		const result = new ResultPage(page);
		await result.expectLoaded();
		await expect(page).toHaveURL(RESULT_URL_PATTERN);

		// #1122 の本体: 遷移先が「見えている」だけでなく「押せる」こと
		await result.close();
		await expect(result.closeButton).toBeHidden();
	});

	// ─ テストケース: 検索中にモーダルを閉じたら、その後の開閉で無関係な店へ飛ばない ─
	//
	// #1122 のレビューで見つかった潜在バグの回帰テスト（本 spec で最も価値が高い）。
	// 未検索候補は「押す → 検索 → キャッシュ → 遷移」と数秒かかる。その待ち時間に
	// ユーザーがモーダルを閉じられるため、素朴な実装だと
	//   (a) 遷移が黙って消える
	//   (b) pending に積んだ navigate が残留し、**次に別候補のモーダルを開いて閉じただけで発火する**
	// という 2 つの事故が起きる。(b) は「別候補を見ていたのに、さっき押した候補の店へ飛ぶ」
	// という最悪の見え方になる。修正版は表示セッションの世代番号で、押下時と完了時の
	// セッションが違えば遷移をキャンセルする。
	//
	// 手順:
	//   1. dish-media 検索を保留する門を仕掛けて結果画面を開く
	//   2. 未検索候補のモーダルを開き「店を見る」を押す（検索が始まり、保留される）
	//   3. 検索中に X でモーダルを閉じる
	//   4. 別候補のモーダルを開いて閉じる（残留 navigate があればここで発火する）
	//   5. 門を開けて検索を完了させる
	//   6. 結果画面へ遷移していないこと（= 結果画面に留まっていること）を検証
	test("検索中にモーダルを閉じたあと別候補を開閉しても、無関係な店へ飛ばない", async ({ page }) => {
		const searchGate = createGate();
		await mockVoteBackend(page, { searchGate });
		await openVoteResult(page);

		// 2. 未検索候補で「店を見る」→ 検索が保留される
		await candidateCard(page, CANDIDATE_NOT_SEARCHED).click();
		await expect(detailModal(page)).toBeVisible();
		await detailViewRestaurants(page).click();

		// 3. 検索の完了を待たずにユーザーが自分でモーダルを閉じる
		await modalCloseButton(page).click();
		await expect(detailModal(page)).toBeHidden();

		// 4. 別候補のモーダルを開閉する。
		//    バグ版はここの close で、手順 2 で積まれた navigate が発火してしまう
		await candidateCard(page, CANDIDATE_OTHER).click();
		await expect(detailModal(page)).toBeVisible();
		await modalCloseButton(page).click();
		await expect(detailModal(page)).toBeHidden();
		await expect(page).not.toHaveURL(RESULT_URL_PATTERN);

		// 5. 保留していた検索を完了させる（キャッシュ API まで走り、遷移が要求される経路に入る）
		searchGate.open();

		// 6. ユーザーは自分でモーダルを閉じている。遷移はキャンセルされ、結果画面に留まる
		await expect(candidateCard(page, CANDIDATE_NOT_SEARCHED)).toBeVisible();
		await expect(new ResultPage(page).closeButton).toBeHidden();
		await expect(page).not.toHaveURL(RESULT_URL_PATTERN);
	});

	// ─ テストケース: 一覧カードの「店を見る」（モーダルを介さない導線）は従来どおり遷移する ─
	// 手順:
	//   1. モーダルを開かずに、カード内の「店を見る」を押す
	//   2. 結果画面へ遷移し、操作できることを検証
	//      → 「閉じるのを待つ」修正が、待つモーダルが無い経路を止めていないことの確認
	test("一覧カードからの「店を見る」はモーダルを介さずに遷移できる", async ({ page }) => {
		await mockVoteBackend(page);
		await openVoteResult(page);

		await page.getByTestId(`dish-category-group-vote-candidate-dish-media-${CANDIDATE_FOUND}`).click();

		await expect(detailModal(page)).toBeHidden();
		const result = new ResultPage(page);
		await result.expectLoaded();
		await result.close();
	});
});
