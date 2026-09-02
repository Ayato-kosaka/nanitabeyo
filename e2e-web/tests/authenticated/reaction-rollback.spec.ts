import { test, expect } from "../../fixtures/test";
import type { Locator, Page } from "@playwright/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";
// #1785 【設計】アイコンの色は **アプリのソースから引く**。spec へ literal を写経すると、
// パレット側が変わったときテストだけが古い色を守り続ける（実際 `orange` → `#ED6C02` の
// 変更に追従できず main が赤いまま放置された）。Palette.ts は import を 1 つも持たない
// 純粋なモジュールなので、e2e-web からそのまま引ける（tsconfig の `@app-expo/*`）。
import { FixedColors } from "@app-expo/constants/Palette";

/** ActionButtons.tsx の Heart / Bookmark が実際に描く fill 属性 */
const ICON_FILL = {
	liked: FixedColors.likeActive,
	notLiked: FixedColors.onMedia,
	saved: FixedColors.myDishStatusOrange,
	notSaved: "transparent",
} as const;

/**
 * ↩️ いいね / 保存の楽観更新が API 失敗時にロールバックされることのテスト（DAT-01 / #1501）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 *
 * ## 何を守っているか（#1501）
 * `ActionButtons.handleLike` / `handleSave` は押下と同時にストア（`useDishMediaEntriesStore`）を
 * 楽観更新する。修正前は API が失敗しても catch でログを出すだけで **楽観更新を戻していなかった**ため、
 * 「画面ではいいね済みなのにサーバには保存されていない」状態が、リロードするまで残り続けた。
 * #1501 で `isLiked` / `likeCount` / `isSaved` と liked・saved タブの一覧を
 * **楽観更新の直前に読んだ値そのもの**へ戻し、`showSnackbar` で再試行できるようにしている。
 *
 * ## なぜ @mutation ではないのか（dev DB への影響）
 * `POST/DELETE v1/dish-media/{id}/reaction` を `page.route()` で **必ず失敗させる**ため、
 * リアクションは 1 件も dev DB へ書き込まれない。フィードへ辿り着くまでの導線
 * （検索・トピック提案・料理メディア取得）はいずれも参照系なので書き込みは発生しない。
 * したがって tests/authenticated/ に置きつつ @mutation タグは付けない。
 * 成功パスの検証は tests/authenticated/reactions.spec.ts（@mutation）が担当する。
 *
 * ## 観測点と「ゲート」方式
 * ロールバックは「楽観更新で一度変わってから、元へ戻る」という **2 段階**の変化である。
 * 最終状態（= 元の値）だけを assert すると、Playwright のポーリングは
 * **楽観更新が反映される前の一瞬**でも成立してしまい、何も検証していないテストになる。
 * そこで review-submit-loading.spec.ts と同じ「ゲート」方式を使い、
 * リクエストを保留したまま **楽観更新後の状態を先に assert** してから失敗させる。
 *
 * 状態の判定は reactions.spec.ts と同じく Heart / Bookmark の `fill` 属性で行う
 * （具体的な色は `ICON_FILL`。値はアプリの Palette から引いており、spec には書かない）。
 * いいね数は testID を持たない `<Text>` なので、ボタンの親（actionContainer）の
 * テキストとして読む（ActionButtons.tsx の描画構造を参照）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

/** いいね / 保存のどちらも同じエンドポイントを使う（区別は body の action_type） */
const REACTION_URL = "**/v1/dish-media/*/reaction";

/** ja-JP: DishMediaContent.errors.likeReactionFailed */
const LIKE_FAILED_MESSAGE = "いいねの更新に失敗しました。もう一度お試しください。";
/** ja-JP: DishMediaContent.errors.saveReactionFailed */
const SAVE_FAILED_MESSAGE = "保存の更新に失敗しました。もう一度お試しください。";
/** ja-JP: Common.retry（スナックバーのアクションラベル） */
const RETRY_LABEL = "再試行";

/** 保留したリアクション API を任意のタイミングで失敗させるためのゲート */
type ReactionGate = {
	/** これまでに着弾したリアクション API の件数 */
	count(): number;
	/** 保留中のリクエストを解放し、すべて失敗で終わらせる */
	release(): void;
	/** ルーティングを解除する */
	stop(): Promise<void>;
};

/**
 * リアクション API を「解放するまで応答せず、解放したら必ず失敗する」ルートへ差し替える。
 *
 * `route.abort("failed")` を使うのは、HTTP エラーを `fulfill` で返すと別オリジン（Cloud Run）
 * ゆえに CORS ヘッダを自前で面倒みる必要があるため。ネットワークエラーでも
 * `useAPICall` は同じく例外を投げるので、ロールバック経路の検証には十分である。
 * POST / DELETE は `useAPICall` の自動リトライ対象外（GET のみ 1 回リトライ）なので、
 * 1 回の押下がちょうど 1 件の着弾になる。
 */
async function stubFailingReaction(page: Page): Promise<ReactionGate> {
	let count = 0;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});

	const handler = async (route: import("@playwright/test").Route): Promise<void> => {
		count += 1;
		await gate;
		await route.abort("failed");
	};
	await page.route(REACTION_URL, handler);

	return {
		count: () => count,
		release: () => release(),
		stop: () => page.unroute(REACTION_URL, handler),
	};
}

/**
 * いいね数の表示テキストを読む。
 *
 * ActionButtons.tsx はボタンとカウントを `actionContainer` の View でくるんでいるため、
 * ボタンの親要素のテキスト = いいね数になる（`formatLikeCount` 後の文字列）。
 */
async function likeCountText(likeButton: Locator): Promise<string> {
	return (await likeButton.locator("..").innerText()).trim();
}

/** 検索 → トピック提案 → 結果フィードまで進める（reactions.spec.ts と同一の導線） */
async function openResultFeed(appPage: Page): Promise<ResultPage> {
	const searchPage = new SearchPage(appPage);
	const dishCategoriesPage = new DishCategoriesPage(appPage);
	const resultPage = new ResultPage(appPage);

	await searchPage.typeLocation("渋谷");
	await searchPage.selectLocationSuggestion(0);
	await searchPage.submitButton.click();
	await dishCategoriesPage.expectLoaded();
	await dishCategoriesPage.chooseFirstDishCategory();
	await resultPage.expectLoaded();

	return resultPage;
}

test.describe("いいね / 保存の失敗時ロールバック", () => {
	// #1629 この spec は `route.abort("failed")` で **わざと通信を失敗させて** ロールバックを見る。
	// ブラウザはそれを net::ERR_FAILED として console へ出すので、前提が生むノイズとして許容する
	test.use({ allowedConsoleErrors: ["net::ERR_FAILED"] });

	// 検索 → トピック提案 → 結果フィード遷移は AI 生成待ちで時間がかかるため、
	// reactions.spec.ts と同じ理由で既定の 30 秒テストタイムアウトを延長する
	test.setTimeout(90_000);

	// AI レコメンドが選ぶ料理・店舗によっては dev 環境側のデータ不備で結果フィード取得が
	// 500 になることが実測で確認されている（reactions.spec.ts の同コメント参照）。
	// アプリ側の既知の不安定要素なので、このファイルに限りリトライを許容する
	test.describe.configure({ retries: 2 });

	// ─ テストケース: いいねが失敗したら表示が元へ戻る ─
	// 手順:
	//   1. ログイン済みで結果フィードを開き、いいねの現在状態（fill といいね数）を控える
	//   2. リアクション API を「解放するまで応答しない」ルートへ差し替える
	//   3. いいねボタンを押し、API へ 1 件着弾したことを確認する
	//   4. **この時点で** fill が反転していることを検証（= 楽観更新が効いている）
	//   5. ゲートを開けて API を失敗させる
	//   6. 失敗スナックバーが出ることを検証
	//   7. fill といいね数が **手順 1 の値へ戻っている**ことを検証（= ロールバック）
	//      修正前はここで反転したままになる
	test("いいねの API が失敗したら、アイコンといいね数が押す前の値へ戻る", async ({ appPage }) => {
		const resultPage = await openResultFeed(appPage);

		const likeButton = resultPage.likeButton.first();
		const likeIcon = likeButton.locator("svg");
		const initialFill = await likeIcon.getAttribute("fill");
		const initialCount = await likeCountText(likeButton);
		// 反転後の期待値。未いいね → いいね済み とその逆
		const optimisticFill = initialFill === ICON_FILL.liked ? ICON_FILL.notLiked : ICON_FILL.liked;

		const gate = await stubFailingReaction(appPage);

		await likeButton.click();

		// 押下が API まで届いた = 楽観更新はすでに走っている（handleLike は更新の後に呼ぶ）
		await expect.poll(() => gate.count()).toBe(1);
		await expect(likeIcon, "押下直後は楽観更新でアイコンが反転しているはず").toHaveAttribute("fill", optimisticFill);

		gate.release();

		await expect(appPage.getByText(LIKE_FAILED_MESSAGE, { exact: true })).toBeVisible();
		await expect(likeIcon, "API 失敗後はアイコンが押す前の状態へ戻るはず").toHaveAttribute(
			"fill",
			initialFill ?? ICON_FILL.notLiked,
		);
		await expect
			.poll(() => likeCountText(likeButton), { message: "API 失敗後はいいね数が押す前の値へ戻るはず" })
			.toBe(initialCount);

		await gate.stop();
	});

	// ─ テストケース: 保存が失敗したら表示が元へ戻る ─
	// 手順はいいねと同じ（保存ボタン dish-action-save / fill は ICON_FILL.saved ⇔ notSaved）
	test("保存の API が失敗したら、アイコンが押す前の状態へ戻る", async ({ appPage }) => {
		const resultPage = await openResultFeed(appPage);

		const saveButton = resultPage.saveButton.first();
		const saveIcon = saveButton.locator("svg");
		const initialFill = await saveIcon.getAttribute("fill");
		const optimisticFill = initialFill === ICON_FILL.saved ? ICON_FILL.notSaved : ICON_FILL.saved;

		const gate = await stubFailingReaction(appPage);

		await saveButton.click();

		await expect.poll(() => gate.count()).toBe(1);
		await expect(saveIcon, "押下直後は楽観更新でアイコンが反転しているはず").toHaveAttribute("fill", optimisticFill);

		gate.release();

		await expect(appPage.getByText(SAVE_FAILED_MESSAGE, { exact: true })).toBeVisible();
		await expect(saveIcon, "API 失敗後はアイコンが押す前の状態へ戻るはず").toHaveAttribute(
			"fill",
			initialFill ?? ICON_FILL.notSaved,
		);

		await gate.stop();
	});

	// ─ テストケース: 失敗スナックバーの「再試行」から押し直せる ─
	// #1205 の連打ガード（inFlightActionsRef）は finally で必ず解除される。
	// ロールバックを足した後もそこが壊れていないこと（= 失敗しても操作を続けられること）を、
	// スナックバーのアクション経由で 2 回目の API が飛ぶことで確認する。
	//
	// 手順:
	//   1. 結果フィードでいいねを押し、失敗させる（1 件目）
	//   2. スナックバーの「再試行」を押す
	//   3. API がもう 1 件着弾することを検証（ガードが解除されている証拠）
	//   4. 2 回目も失敗するので、表示は最初の状態のままであることを検証
	test("失敗スナックバーの再試行から押し直せて、失敗し続けても表示は元のまま", async ({ appPage }) => {
		const resultPage = await openResultFeed(appPage);

		const likeButton = resultPage.likeButton.first();
		const likeIcon = likeButton.locator("svg");
		const initialFill = await likeIcon.getAttribute("fill");

		// 1 回目は保留せず即失敗させたいので、ゲートは押下前に開けておく
		const gate = await stubFailingReaction(appPage);
		gate.release();

		await likeButton.click();

		const snackbar = appPage.getByText(LIKE_FAILED_MESSAGE, { exact: true });
		await expect(snackbar).toBeVisible();
		await expect(likeIcon).toHaveAttribute("fill", initialFill ?? ICON_FILL.notLiked);
		expect(gate.count(), "1 回の押下で API 着弾は 1 件のはず").toBe(1);

		// 再試行はスナックバーのアクションボタン（Common.retry）。
		// 押すと handleLike が呼び直され、ガードが解除されていれば 2 件目が飛ぶ
		await appPage.getByText(RETRY_LABEL, { exact: true }).click();
		await expect.poll(() => gate.count(), { message: "再試行で 2 件目の API が飛ぶはず" }).toBe(2);

		// 2 回目も失敗するため、最終的な表示は最初の状態のまま
		await expect(likeIcon).toHaveAttribute("fill", initialFill ?? ICON_FILL.notLiked);

		await gate.stop();
	});
});
