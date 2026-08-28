import { describeMutation, expect, element, launchAppWithSession } from "../../fixtures/e2e";
import { DishCategoryGroupVoteResultScreen } from "../../screens/DishCategoryGroupVoteResultScreen";
import { NotificationsScreen } from "../../screens/NotificationsScreen";
import { TabBar } from "../../screens/TabBar";
import { seedGroupVoteNotification, type SeededGroupVoteNotification } from "../../utils/groupVoteNotification";

/**
 * 🔔🗳 友達投票の完了をホストへ通知する @mutation（#1506 GRP-04）
 *
 * 対応する e2e-web の spec: tests/authenticated/group-vote-notification.spec.ts
 *
 * ## 何を守るテストか
 * 参加者が友達投票を送信すると、ホストの通知一覧に **投票完了通知が 1 件増える**。
 * その通知は `Vote` アイコンで描かれ、押すと投票結果画面（`[shareToken]`）へ遷移する。
 * 遷移先の解決には #1506 で追加した `NotificationItem.dishCategoryGroupVoteSession.shareToken` を使う
 * （通知が持つのは内部 session id だけで、それでは結果画面の route param にならない）。
 *
 * ## ⚠️ web 側とスコープが違う（重要）
 * web は通知一覧 API を `page.route()` で固定して「vote 行の見た目・文言・遷移先」を
 * 決定論的に検証する。Detox にはネットワークを差し替える仕組みが無い
 * （tests/authenticated/dish-category-group-vote-completion-identity.test.ts に既述）ので、
 * ここは逆に **実 API で本物の通知を作ってから**開く。
 *
 * その代わり native 側では次を検証していない:
 * - 通知の**文言**（`があなたのグループ投票に投票しました`）… 端末ロケール依存で読み取りが不安定。web 側で担保
 * - 通知一覧の**件数の増分**… 共有 dev のテストユーザーは他の spec が作った通知も持つため、
 *   「1 件増えた」を厳密に言えない。ここでは「vote 種別の通知が存在すること」に絞る
 *
 * ## 前提は spec 自身が作る
 * ホストとは別ユーザーが投票しないと通知は生まれない（自己通知は API 側で skip される）。
 * `utils/groupVoteNotification.ts` が
 * 「ホスト = テストユーザー」「参加者 = 匿名ユーザー」の 2 セッションで実 API を叩き、前提を用意する。
 *
 * ## ⚠️ dev DB への影響（不可逆・@mutation の理由が 2 つある）
 * 1. 種まきが投票セッション・参加者・投票・通知を 1 件ずつ追加する（削除導線は無い。
 *    tests/mutation/dish-categories-group-vote-double-tap.test.ts と同じ性質）
 * 2. 通知一覧は入場時に `markAllAsRead()` を呼び、既読状態を書き換える
 *    （tests/mutation/notifications-safe-area.test.ts と同じ理由）
 * 必ずテスト専用ユーザーで、`RUN_MUTATION=1` を明示したときだけ実行すること。
 */
describeMutation("友達投票の完了通知（ホスト側） @mutation", () => {
	const tabBar = new TabBar();
	const notifications = new NotificationsScreen();
	const voteResult = new DishCategoryGroupVoteResultScreen();

	/**
	 * 通知は Cloud Tasks の非同期ジョブが作るため、投票の送信直後にはまだ存在しない。
	 * 端末の起動（数十秒）ぶんの猶予に加えて、一覧側でも余裕を持って待つ。
	 */
	const NOTIFICATION_TIMEOUT = 90_000;

	/** 結果画面は detail の取得を挟むので、カード表示より長めに見る */
	const VOTE_RESULT_TIMEOUT = 60_000;

	let seeded: SeededGroupVoteNotification;

	beforeAll(async () => {
		// 端末を起動する前に前提を作る。起動を待つ時間がそのまま
		// 「通知ジョブが処理される時間」になるので、この順序には意味がある
		seeded = await seedGroupVoteNotification();
		console.log(`ℹ️ 投票完了通知の前提を作りました（shareToken=${seeded.shareToken}）。`);
	});

	beforeEach(async () => {
		// #1031 テストごとに起動し直して独立性を担保する
		// #1030 3-1 セッション注入起動は匿名クォータを消費しない
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: 投票完了通知が一覧に出て、押すと投票結果画面へ遷移する ─
	// 手順:
	//   1. （beforeAll）ホストとして投票セッションを作り、匿名ユーザーとして投票を完了する
	//   2. ホストのセッションでアプリを起動し、お知らせタブへ切り替える
	//   3. vote 種別の通知行が現れるまで待つ（非同期ジョブぶんの猶予を取る）
	//   4. vote 用のアイコンが描かれていることを検証（like/save と同じ見た目で出ていないこと）
	//   5. 最上段（= 最新）の vote 通知を押し、投票結果画面が開くことを検証
	//      → shareToken の解決が壊れていると push 自体が起きず、通知一覧に留まって落ちる
	it("投票完了通知が一覧に表示され、押すと投票結果画面へ遷移する", async () => {
		await tabBar.gotoNotifications();
		await notifications.expectLoaded();

		await notifications.expectNotificationItem("vote", NOTIFICATION_TIMEOUT);
		await expect(element(notifications.notificationIcon("vote")).atIndex(0)).toBeVisible();

		await notifications.openNotificationItem("vote");

		// 結果画面が開いたことの観測点は「共有リンクをコピー」（画面 1 枚につき 1 つだけ）。
		// 候補 id を知らなくても判定できる（DishCategoryGroupVoteResultScreen の JSDoc 参照）
		await voteResult.expectSingleLoaded(VOTE_RESULT_TIMEOUT);
	});
});
