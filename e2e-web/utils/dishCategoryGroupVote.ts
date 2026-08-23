import type { Page } from "@playwright/test";
import type { DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";

/**
 * 🗳 友達投票（dish category group vote）の E2E 用ユーティリティ
 *
 * ## なぜ API をモックするのか（#1120）
 * 検証対象は「ログイン状態が確定する前にゲスト用 UI を描かない」という **描画順序の不変条件** であって、
 * 投票セッションそのものの生成・集計ではない。実データで検証しようとすると
 *
 * - 事前に dev DB へ投票セッションを作る（= @mutation 相当の書き込み）
 * - shareToken を環境変数などでテストへ受け渡す
 * - セッションが「未投票」状態であることを毎回保証する（hasVoted なら結果画面へ redirect される）
 *
 * という前提が必要になり、不変条件と無関係な理由でフレークする。
 * detail API を `page.route()` で固定レスポンスに差し替えれば、候補 1 件の投票画面を決定論的に
 * 開けるうえ dev DB を一切汚さない（このテストが @mutation 扱いにならない理由でもある）。
 */

/** 固定 shareToken。モックするので実在しなくてよい */
export const MOCK_SHARE_TOKEN = "e2e-1120-share-token";

/** 固定 sessionId。投票送信 API のパスに現れる */
export const MOCK_SESSION_ID = "00000000-0000-4000-8000-000000000120";

/** detail API のパス（末尾に追加セグメントを持つ vote/candidates 系とは一致させない） */
const DETAIL_URL_PATTERN = /\/v1\/dish-category-group-votes\/[^/?]+(\?.*)?$/;

/** ログインユーザーのプロフィール取得 API（useEnsureOwnProfileLoaded が叩く） */
const OWN_PROFILE_URL_PATTERN = /\/v1\/users\/[^/?]+(\?.*)?$/;

/**
 * 投票画面の URL。
 * `app/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]/vote.tsx` に対応する
 * （`(tabs)` は Expo Router のグループなので URL には現れない）。
 */
export function voteScreenPath(shareToken: string = MOCK_SHARE_TOKEN): string {
	return `/ja-JP/search/dish-category-group-votes/${shareToken}/vote`;
}

/**
 * 候補 1 件だけの detail レスポンスを組み立てる。
 *
 * 候補を 1 件にしているのは、`DishCategoryGroupVoteVoteScreen` が
 * 「最後の候補に投票した時点で完了モーダルを開く」実装のため、
 * **1 回タップするだけで完了モーダルへ到達できる** から（操作が増えるほどフレーク要因も増える）。
 */
export function buildVoteDetail(
	sessionOverrides: Partial<DishCategoryGroupVoteDetailResponse["session"]> = {},
): DishCategoryGroupVoteDetailResponse {
	const now = "2026-01-01T00:00:00.000Z";
	return {
		session: {
			id: MOCK_SESSION_ID,
			shareToken: MOCK_SHARE_TOKEN,
			hostUserId: "00000000-0000-4000-8000-0000000001a0",
			searchContext: {
				location: { latitude: 35.6595, longitude: 139.7005 },
				radius: 1000,
				priceLevels: [],
				localLanguageCode: "ja",
			},
			isHost: false,
			// #1120 true だと結果画面へ router.replace されて投票画面に居られない
			hasVoted: false,
			participantCount: 0,
			createdAt: now,
			updatedAt: now,
			// #1506 呼び出し側が hasVoted / isHost / shareToken を差し替えられるようにする。
			// 「投票済みホストが結果画面を開く」など、画面ごとに要る前提が違うため
			...sessionOverrides,
		},
		candidates: [
			{
				id: "00000000-0000-4000-8000-0000000002a0",
				dishCategoryId: "00000000-0000-4000-8000-0000000003a0",
				displayName: "ラーメン",
				tagline: "こってり系",
				imageUrl: "https://example.invalid/e2e-1120.jpg",
				dishMediaIds: [],
				dishMediaSearchStatus: "not_searched",
				displayOrder: 0,
				deletedAt: null,
				likeCount: 0,
				dislikeCount: 0,
				rank: null,
				votes: [],
			},
		],
		participants: [],
	};
}

/**
 * detail API をモックに差し替える。
 * 画像は example.invalid を指しているので読み込みは失敗するが、
 * 検証対象は完了モーダルの描画順序なのでカードの画像有無は問わない。
 */
export async function mockVoteDetail(
	page: Page,
	sessionOverrides: Partial<DishCategoryGroupVoteDetailResponse["session"]> = {},
): Promise<void> {
	await page.route(DETAIL_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			// ⚠️ **BaseResponse の封筒 `{ success, data }` を外さないこと。**
			// `useAPICall` は `data` だけを取り出すので、素の detail を返すと
			// undefined が渡って画面が「投票を読み込めませんでした」になる。
			// 失敗の見た目が「API が落ちている」ときと同じなので、mock 側の
			// 封筒漏れだと気付くのに時間がかかる（実際 3 spec がこれで落ちていた）。
			body: JSON.stringify({ success: true, data: buildVoteDetail(sessionOverrides) }),
		});
	});
}

/** 投票送信 API（POST /v1/dish-category-group-votes/:sessionId/vote）のパス */
const SUBMIT_VOTE_URL_PATTERN = /\/v1\/dish-category-group-votes\/[^/?]+\/vote(\?.*)?$/;

/**
 * 投票送信 API をモックに差し替え、**送られたリクエストボディを記録する**（#1506 GRP-04）。
 *
 * ホストへの通知は「投票の送信が API に届いたこと」を起点にサーバ側で enqueue される
 * （api/src/v1/dish-category-group-votes/dish-category-group-votes.service.ts）。
 * ブラウザ側から観測できるのはその起点までなので、ここを押さえる。
 * enqueue そのものは API のユニットテストが担保している。
 *
 * 実 API へ流さないので dev DB へ参加者行は増えない（= この spec は @mutation にならない）。
 *
 * @returns 記録された送信ボディの配列（テスト側から件数と中身を検証できる）
 */
export async function mockSubmitVote(page: Page): Promise<Array<Record<string, unknown>>> {
	const submitted: Array<Record<string, unknown>> = [];

	await page.route(SUBMIT_VOTE_URL_PATTERN, async (route) => {
		// postDataJSON() はボディが JSON でないと throw する。記録に失敗しても
		// 「送信された事実」だけは残したいので、空オブジェクトで補う
		try {
			submitted.push(route.request().postDataJSON() as Record<string, unknown>);
		} catch {
			submitted.push({});
		}
		await route.fulfill({
			status: 201,
			contentType: "application/json",
			body: JSON.stringify({
				success: true,
				data: { participantId: "00000000-0000-4000-8000-0000000015f0", stored: true },
			}),
		});
	});

	return submitted;
}

/**
 * ログインユーザーのプロフィール取得 API を **意図的に遅延** させる。
 *
 * #1120 の不具合は「ログイン状態が確定するまでの数百 ms だけゲスト用の絵文字候補が出る」もので、
 * 素の実行では競合窓が短すぎて「出ていないこと」を安定して観測できない。
 * ここで窓を人為的に広げることで、回帰したときに **必ず** 検知できるようにする。
 *
 * @returns 遅延を解除して本来のレスポンスへ進ませる関数（呼ぶまで応答は返らない）
 */
export async function delayOwnProfile(page: Page): Promise<() => void> {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});

	await page.route(OWN_PROFILE_URL_PATTERN, async (route) => {
		await released;
		await route.continue();
	});

	return release;
}

/** ゲスト用の絵文字候補（名前サジェスト）が一度でも DOM に現れたかを記録するグローバル変数名 */
export const GUEST_SUGGESTION_SEEN_FLAG = "__e2e1120GuestSuggestionSeen";

/** ゲスト用 UI の testID */
export const GUEST_SUGGESTION_TEST_ID = "dish-category-group-vote-name-suggestions";

/**
 * ゲスト用 UI の出現を **MutationObserver で常時監視** する見張りを仕込む。
 *
 * `expect(locator).toHaveCount(0)` のポーリングだけでは、ポーリングとポーリングの
 * 隙間に現れて消えた「一瞬の描画」を取りこぼす。#1120 の不具合はまさにその形なので、
 * DOM 変更を漏らさず拾う MutationObserver を併用して「一度も現れていない」ことを保証する。
 *
 * `page.goto()` より前（= addInitScript）に仕込む必要がある。
 */
export async function watchGuestSuggestionFlash(page: Page): Promise<void> {
	await page.addInitScript(
		([flag, testId]) => {
			const selector = `[data-testid="${testId}"]`;
			const win = window as unknown as Record<string, boolean>;
			win[flag] = false;

			const check = () => {
				if (document.querySelector(selector)) {
					win[flag] = true;
				}
			};

			const start = () => {
				check();
				new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
			};

			if (document.body) {
				start();
			} else {
				document.addEventListener("DOMContentLoaded", start, { once: true });
			}
		},
		[GUEST_SUGGESTION_SEEN_FLAG, GUEST_SUGGESTION_TEST_ID] as const,
	);
}

/** watchGuestSuggestionFlash が記録した「一度でも現れたか」を読み出す */
export async function hasGuestSuggestionEverAppeared(page: Page): Promise<boolean> {
	return page.evaluate(
		(flag) => Boolean((window as unknown as Record<string, boolean>)[flag]),
		GUEST_SUGGESTION_SEEN_FLAG,
	);
}
