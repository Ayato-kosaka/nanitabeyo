import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { mockSubmitVote, mockVoteDetail, voteScreenPath } from "../../utils/dishCategoryGroupVote";
import {
	MOCK_VOTE_ACTOR_NAME,
	MOCK_VOTE_NOTIFICATION_SHARE_TOKEN,
	buildLikeNotification,
	buildVoteNotification,
	mockNotifications,
	notificationsScreenPath,
	voteResultScreenPath,
} from "../../utils/notifications";

/**
 * 🔔🗳 友達投票の完了をホストへ通知する（#1506 GRP-04）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 *
 * 対応する e2e-mobile の spec: tests/mutation/group-vote-notification.test.ts
 *
 * ## この PR が変えたこと
 * 参加者が友達投票を送信すると、サーバが `dish_category_group_vote_sessions` / `vote` の
 * 通知ジョブを enqueue し、**ホストの通知一覧に 1 件増える**。増えた通知は
 * - `Vote` アイコン（緑背景）で描かれ
 * - 文言は `Notifications.notification.dish_category_group_vote_sessions.vote`
 * - 押すと **投票結果画面（`[shareToken]`）** へ遷移する
 * という 3 点で既存種別（like / save）と区別される。
 *
 * ## ブラウザから観測できる範囲と、できない範囲（正直に書く）
 * ブラウザ側で観測できるのは **両端** だけである:
 * - 起点: 投票の送信が `POST /v1/dish-category-group-votes/:sessionId/vote` として飛ぶこと（テスト 1）
 * - 終点: その通知が一覧に現れたときの見た目と遷移先（テスト 2）
 *
 * 「起点 → 終点」を繋ぐ **サーバ側の enqueue と recipient 解決は E2E では観測できない**。
 * Cloud Tasks の非同期ジョブであり、かつホストは投票者とは別ユーザーで、
 * e2e-web のテストユーザーは 1 人しか無いためブラウザだけでは両者を演じ分けられない。
 * そこは API のユニットテストが担保している:
 * - `api/src/v1/dish-category-group-votes/dish-category-group-votes.service.spec.ts`
 *   … submitVote 成功後に enqueue すること / 失敗しても投票は成功として返すこと
 * - `api/src/internal/notifications/notification-job.service.spec.ts`
 *   … recipient がセッションのホストになること / 自己通知を skip すること / 文言
 *
 * ## dev DB への影響
 * 無し。detail・投票送信・通知一覧・一括既読のすべてを `page.route()` で差し替えるため、
 * 実 API へは 1 本も届かない（通知一覧は入場時に `markAllAsRead()` を呼ぶので、
 * **モックし忘れると既読状態を不可逆に書き換える**。utils/notifications.ts 参照）。
 * @mutation を付けていないのはこのため。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）が未設定のためスキップ",
);

test.describe("友達投票の完了通知（ホスト側）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース 1: 投票の完了が通知の起点（送信 API）まで到達する ─
	// 手順:
	//   1. 投票セッション detail と投票送信 API をモックして投票画面を開く
	//   2. 候補 1 件へ投票して完了モーダルを開く
	//   3. 表示名を入れて「投票完了」を押す
	//   4. 送信 API が **1 回だけ** 呼ばれ、投票内容が載っていることを検証
	//      （この POST がサーバ側の通知 enqueue の起点そのもの）
	//   5. 送信後に投票結果画面へ遷移することを検証（送信が成功扱いになったことの裏取り）
	test("投票を完了すると投票送信 API が 1 回だけ呼ばれ、結果画面へ遷移する", async ({ appPage }) => {
		await mockVoteDetail(appPage);
		const submitted = await mockSubmitVote(appPage);

		await appPage.goto(voteScreenPath());

		// 候補は 1 件だけなので、1 回投票すればそのまま完了モーダルが開く
		await appPage.getByTestId("dish-category-group-vote-like-button").click();
		await expect(appPage.getByTestId("dish-category-group-vote-completion-form")).toBeVisible();

		// ログイン済みユーザーは display_name が初期入力されるが、その値はテストユーザー依存。
		// 送信ボディを検証するため、ここで決定論的な値へ上書きする
		await appPage.getByTestId("dish-category-group-vote-display-name-input").fill("E2E投票者");

		await appPage.getByTestId("dish-category-group-vote-submit").click();

		// 送信後は結果画面へ router.replace される（DishCategoryGroupVoteVoteScreen.handleSubmit）
		await appPage.waitForURL(/\/search\/dish-category-group-votes\/[^/]+$/);

		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ displayName: "E2E投票者" });
		expect((submitted[0] as { votes: unknown[] }).votes).toHaveLength(1);
	});

	// ─ テストケース 2: 投票通知が一覧に出て、押すと投票結果画面へ行く ─
	// 手順:
	//   1. 通知一覧を「vote 1 件 + like 1 件」でモックする
	//      （like を混ぜるのは、testID が vote の行だけを指していることを保証するため）
	//   2. 通知タブを開く
	//   3. vote 行が 1 件だけ描かれ、アクター名と GRP-04 の文言が出ていることを検証
	//   4. vote 用のアイコンが描かれていることを検証（like と同じ testID にならないこと）
	//   5. vote 行を押すと `[shareToken]` の投票結果画面へ遷移することを検証
	//      → shareToken は notification.dishCategoryGroupVoteSession から取る。
	//        このフィールドを落とす回帰では push 自体が起きず、URL が変わらないので落ちる
	test("投票通知が一覧に表示され、押すと投票結果画面へ遷移する", async ({ appPage }) => {
		await mockNotifications(appPage, [buildVoteNotification(), buildLikeNotification()]);
		// 遷移先（結果画面）が実 API を叩かずに描けるようにしておく。
		// ホスト自身が結果を見に行く状況なので isHost / hasVoted は true
		await mockVoteDetail(appPage, {
			shareToken: MOCK_VOTE_NOTIFICATION_SHARE_TOKEN,
			isHost: true,
			hasVoted: true,
		});

		await appPage.goto(notificationsScreenPath());

		const voteRow = appPage.getByTestId("notification-item-vote");
		await expect(voteRow).toHaveCount(1);
		await expect(voteRow).toBeVisible();

		// アクター名 + GRP-04 の文言（ja-JP: Notifications.notification.dish_category_group_vote_sessions.vote）。
		// 文言のキーを間違えると i18n がキー文字列をそのまま描くため、ここで落ちる
		await expect(voteRow).toContainText(MOCK_VOTE_ACTOR_NAME);
		await expect(voteRow).toContainText("があなたのグループ投票に投票しました");

		// アイコンの出し分け（vote → Vote アイコン / 緑背景）。like 側と共存していることも見る
		await expect(appPage.getByTestId("notification-icon-vote")).toHaveCount(1);
		await expect(appPage.getByTestId("notification-icon-like")).toHaveCount(1);

		await voteRow.click();

		/*
		⚠️ **glob で待たないこと**（#1785）。expo-router はこの遷移で `shareToken` を
		パスへ埋めたうえ **クエリにも付ける**ので、実際の URL は

		    /ja-JP/search/dish-category-group-votes/e2e-1506-share-token?shareToken=e2e-1506-share-token

		になる。`waitForURL("**" + path)` はクエリ込みの URL 全体に掛かるため一致せず、
		«遷移していない» のと同じ見た目（30 秒のタイムアウト）で落ちていた。実際には
		遷移も描画も成功している（実ブラウザで確認済み）。

		この spec が守りたいのは «押したら結果画面（その shareToken）へ着く» ことなので、
		パス名で待つ。遷移が起きなければ・別の画面へ行けば、これまでどおり落ちる。
		*/
		await expect
			.poll(() => new URL(appPage.url()).pathname, { message: "投票結果画面へ遷移しない" })
			.toBe(voteResultScreenPath());
	});
});
