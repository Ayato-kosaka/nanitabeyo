import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";
import { stubNotificationPreferences } from "../../utils/notificationPreferences";

/**
 * 🔔 設定画面の通知カテゴリ別オン/オフ（#1510 SET-02）
 *
 * 実行プロジェクト: desktop-chrome-authenticated(storageState 注入済み)
 * 前提: e2e-web/.env に TEST_USER_EMAIL / TEST_USER_PASSWORD が設定されていること。
 *
 * ## この spec が守るもの
 * 「オフにしたことがサーバーへ届く」までを画面から検証する。オフにしたときに
 * **プッシュが実際に送られない**ことはサーバー側の責務なので、そちらは
 * `api/src/internal/notifications/notification-job.preferences.spec.ts` が固定している。
 * e2e が見るのは「ユーザーの操作 → API リクエスト」と「失敗時に嘘の状態を残さない」こと。
 *
 * ## API はスタブしている
 * `user_notification_preferences` の migration が未適用（オーナー承認待ち）であること、
 * および PATCH が共有 dev アカウントの設定を実際に書き換えてしまうことの 2 つが理由。
 * 詳細は `utils/notificationPreferences.ts` の冒頭コメント参照。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("設定 > 通知カテゴリ別オン/オフ", () => {
	// ─ テストケース: 3 カテゴリのトグルがサーバーの値どおりに描かれる ─
	// 手順:
	//   1. GET を likes=false / saves=true / group_votes=true でスタブする
	//   2. 設定画面を開く
	//   3. 通知カード(settings-notifications-card)が表示されることを検証
	//   4. 各トグルの aria-checked がスタブした値と一致することを検証
	//
	// 「全部オン」を描いてしまう実装（取得失敗時に既定値へフォールバックする等）だと
	// likes のアサーションで落ちる。ここが嘘をつくと、ユーザーは自分の設定を誤認する
	test("サーバーが返した値どおりに 3 カテゴリのトグルが描かれる", async ({ context, appPage }) => {
		await stubNotificationPreferences(context, { initial: { likes: false } });

		const settingsPage = new SettingsPage(appPage);
		// #1629 通知カードは `profile/notifications` の専用ページへ移った
		await settingsPage.gotoNotificationSettings();

		await expect(settingsPage.notificationsCard).toBeVisible();
		await expect(settingsPage.notificationToggle("likes")).toBeVisible();
		await expect(settingsPage.notificationToggle("saves")).toBeVisible();
		await expect(settingsPage.notificationToggle("group_votes")).toBeVisible();

		expect(await settingsPage.isNotificationToggleOn("likes")).toBe(false);
		expect(await settingsPage.isNotificationToggleOn("saves")).toBe(true);
		expect(await settingsPage.isNotificationToggleOn("group_votes")).toBe(true);
	});

	// ─ テストケース: オフにすると該当カテゴリだけが API へ送られる ─
	// 手順:
	//   1. 全カテゴリオンでスタブする
	//   2. 「いいね」の行をクリックする
	//   3. トグルがオフになることを検証
	//   4. PATCH が likes=false の 1 回だけ観測されることを検証
	//   5. 他カテゴリ(saves)のトグルがオンのままであることを検証
	//
	// カテゴリが独立していることをここで押さえる。likes を切ったら saves まで
	// 切れる実装（カテゴリ key の取り違え）は、トグルの見た目だけでは気付けない
	test("いいねをオフにすると likes だけが API へ送られる", async ({ context, appPage }) => {
		const stub = await stubNotificationPreferences(context);

		const settingsPage = new SettingsPage(appPage);
		// #1629 通知カードは `profile/notifications` の専用ページへ移った
		await settingsPage.gotoNotificationSettings();
		await expect(settingsPage.notificationToggle("likes")).toBeVisible();

		await settingsPage.notificationToggle("likes").click();

		await expect(async () => {
			expect(await settingsPage.isNotificationToggleOn("likes")).toBe(false);
		}).toPass();
		expect(stub.updates()).toEqual([{ category: "likes", enabled: false }]);
		expect(stub.current()).toMatchObject({ likes: false, saves: true, group_votes: true });
		expect(await settingsPage.isNotificationToggleOn("saves")).toBe(true);
	});

	// ─ テストケース: 一度オフにしたものを再びオンにできる ─
	// 手順:
	//   1. likes=false でスタブする
	//   2. 設定画面で「いいね」の行をクリックする
	//   3. PATCH が likes=true で送られ、トグルがオンになることを検証
	//
	// オフは可逆であるという仕様（プッシュ抑止であって記録の破棄ではない）の入口側
	test("オフにしたカテゴリを再びオンにできる", async ({ context, appPage }) => {
		const stub = await stubNotificationPreferences(context, { initial: { likes: false } });

		const settingsPage = new SettingsPage(appPage);
		// #1629 通知カードは `profile/notifications` の専用ページへ移った
		await settingsPage.gotoNotificationSettings();
		await expect(settingsPage.notificationToggle("likes")).toBeVisible();
		expect(await settingsPage.isNotificationToggleOn("likes")).toBe(false);

		await settingsPage.notificationToggle("likes").click();

		await expect(async () => {
			expect(await settingsPage.isNotificationToggleOn("likes")).toBe(true);
		}).toPass();
		expect(stub.updates()).toEqual([{ category: "likes", enabled: true }]);
	});
	// ─────────────────────────────────────────────────────────────
	// #1785 API を **わざと 500 にする**テストだけをここへ隔離する。
	//
	// 500 を返させると、ブラウザ自身が
	//   Failed to load resource: the server responded with a status of 500 ... [<URL>]
	// を console error として必ず出す。これはアプリの不具合ではなく **このテストの仕掛け**
	// そのものなので、REL-08 の «console error があれば失敗» ゲートに掛かって
	// main が赤いまま放置されていた。
	//
	// 許容はこのエンドポイントに限定する。他の URL で 500 が出たら今までどおり落ちる。
	// KNOWN_CONSOLE_NOISE（全 spec 共通）へ入れないのは、通知設定以外の 500 まで
	// 見逃すようになってしまうため。
	test.describe("API が失敗したとき", () => {
		test.use({ allowedConsoleErrors: ["/v1/users/me/notification-preferences"] });

		// ─ テストケース: 保存に失敗したらトグルが元へ戻る ─
		// 手順:
		//   1. PATCH が必ず 500 になるようスタブする
		//   2. 「保存」の行をクリックする
		//   3. PATCH が観測される（＝送ろうとはした）ことを検証
		//   4. トグルがオンへ戻ることを検証
		//
		// 楽観更新したままロールバックしないと、ユーザーは「切ったつもり」で
		// 通知を受け取り続ける。画面と実際の設定がずれる、最も気付きにくい壊れ方
		test("保存に失敗したらトグルが元の値へ戻る", async ({ context, appPage }) => {
			const stub = await stubNotificationPreferences(context, { failUpdates: true });

			const settingsPage = new SettingsPage(appPage);
			// #1629 通知カードは `profile/notifications` の専用ページへ移った
			await settingsPage.gotoNotificationSettings();
			await expect(settingsPage.notificationToggle("saves")).toBeVisible();

			await settingsPage.notificationToggle("saves").click();

			await expect(async () => {
				expect(stub.updates()).toEqual([{ category: "saves", enabled: false }]);
			}).toPass();
			await expect(async () => {
				expect(await settingsPage.isNotificationToggleOn("saves")).toBe(true);
			}).toPass();
		});

		// ─ テストケース: 読み込みに失敗したらトグルを描かず、再試行を出す ─
		// 手順:
		//   1. GET が必ず 500 になるようスタブする
		//   2. 設定画面を開く
		//   3. 再試行行(settings-notifications-error)が表示されることを検証
		//   4. トグルが 1 つも描かれないことを検証
		//
		// 取得できないときに既定値(全部オン)を描くと、オフにしているユーザーへ
		// 「オンです」と嘘をつくうえ、その状態で触ると意図しない上書きが起きる
		test("読み込みに失敗したらトグルを描かず再試行を出す", async ({ context, appPage }) => {
			await stubNotificationPreferences(context, { failLoad: true });

			const settingsPage = new SettingsPage(appPage);
			// #1629 通知カードは `profile/notifications` の専用ページへ移った
			await settingsPage.gotoNotificationSettings();

			await expect(settingsPage.notificationsErrorRow).toBeVisible();
			await expect(settingsPage.notificationToggle("likes")).toHaveCount(0);
			await expect(settingsPage.notificationToggle("saves")).toHaveCount(0);
			await expect(settingsPage.notificationToggle("group_votes")).toHaveCount(0);
		});
	});

	// ─ テストケース: Web では OS 通知拒否の案内を出さない ─
	// 手順:
	//   1. 通常どおりスタブして設定画面を開く
	//   2. OS 案内行(settings-notifications-os-denied)が存在しないことを検証
	//
	// Web には push が無いため、案内を出しても開くべき OS 設定が存在しない。
	// ネイティブ側の案内表示は e2e-mobile 側の観点（#1510 の e2e-mobile spec 参照）
	test("Web では OS 通知拒否の案内を出さない", async ({ context, appPage }) => {
		await stubNotificationPreferences(context);

		const settingsPage = new SettingsPage(appPage);
		// #1629 通知カードは `profile/notifications` の専用ページへ移った
		await settingsPage.gotoNotificationSettings();
		await expect(settingsPage.notificationToggle("likes")).toBeVisible();

		await expect(settingsPage.notificationsOsDeniedNotice).toHaveCount(0);
	});
});
