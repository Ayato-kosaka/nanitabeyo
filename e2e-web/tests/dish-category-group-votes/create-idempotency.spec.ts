import type { Route } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";

/**
 * 🔁 友達投票の作成が再送に対して冪等であること（#1507 / GRP-14）
 *
 * e2e-mobile の tests/mutation/group-vote-create-idempotency.test.ts に対応する。
 *
 * ## 何を守っているか
 * `POST v1/dish-category-group-votes` の再送で、**別々の shareToken を持つ投票セッションが
 * 2 件作られる**事故を防ぐ。2 件できると、片方のリンクを配った参加者と、もう片方を見ている
 * ホストが別の投票を見ることになり、集計が合わない。共有リンクで完結する機能なので気付きにくい。
 *
 * #1205 の `isCreatingRef` 同期ガードが守れるのは「同一 JS タスク内の連打」だけで
 *（それは dishCategories-group-vote-double-tap.spec.ts が担保している）、
 * - 通信のリトライ（アプリ側の再送・プロキシの再送）
 * - オフラインから復帰したときの再送
 * - 画面を離れて戻って ref が初期化されたあとの再操作
 * は守れない。#1507 で **サーバー側の冪等化**（body の `idempotencyKey`）を入れた。
 *
 * ## 観測点
 * 1. **クライアントが同じキーを再送すること**（テスト①）。ここが崩れるとサーバーの冪等化は
 *    一切効かない。ネットワークをスタブするので dev DB を汚さず、migration 適用前でも走る
 * 2. **同じキーの 2 回目が 1 回目と同じ shareToken を返すこと**（テスト②）。
 *    = セッションが 1 件しか作られていない、というサーバー側の事実
 *
 * ## 事故の再現方法
 * 連打（`clickRapid`）では再現できない。ref ガードが同期的に止めてしまい、
 * そもそも 2 発目が飛ばないためである（= 偽陰性）。守りたいのは
 * **「1 発目のレスポンスが失われ、ユーザーがもう一度押す」** という時間の空いた再送なので、
 * `route.abort()` で応答だけを落として本物の再送状況を作る。
 */
test.describe("友達投票の作成が再送に対して冪等（#1507）", () => {
	// AI によるトピック生成に実測 30 秒近くかかるうえ、作成 API を 2 往復させるため延長する
	test.setTimeout(180_000);

	/** 作成 API（GET detail は `/<shareToken>` 配下なのでこの glob には一致しない） */
	const CREATE_URL_GLOB = "**/v1/dish-category-group-votes";

	/** RFC 4122 の v4（API 側 DTO の `@IsUUID(4)` を通る形式） */
	const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	/** リクエスト body から冪等キーを取り出す */
	const idempotencyKeyOf = (route: Route): string | undefined =>
		(route.request().postDataJSON() as { idempotencyKey?: string } | null)?.idempotencyKey;

	/** BaseResponse の封筒付きで返す（`useAPICall` は `data` だけを取り出すので外すと画面がエラーになる） */
	const fulfillEnvelope = async (route: Route, status: number, data: unknown): Promise<void> => {
		const origin = (await route.request().headerValue("origin")) ?? "*";
		await route.fulfill({
			status,
			contentType: "application/json",
			headers: {
				// バックエンドは別オリジン（Cloud Run）。`fetchWithAuth` は web で credentials: "include" を
				// 使うため `*` は使えず、リクエスト元 origin をそのまま返す（utils/network.ts と同じ理由）
				"access-control-allow-origin": origin,
				"access-control-allow-credentials": "true",
			},
			body: JSON.stringify(data),
		});
	};

	// ─ テストケース①: 失敗後の再試行が同じ冪等キーで飛ぶ ─
	// 作成 API はスタブなので **dev DB へ書き込まない**（@mutation ではない）。
	// migration 適用前でも実行できる。
	// 手順:
	//   1. 検索してトピック提案画面まで進む
	//   2. 作成 API をスタブし、1 発目だけ 503 で落とす
	//   3. 「友達投票開始」を押す → 失敗して画面に留まる（ガードは catch で解除される）
	//   4. もう一度押す → 2 発目は 201 を返す
	//   5. **2 回のリクエストの `idempotencyKey` が同じ**ことを検証（ここが本体）
	//      違う値だとサーバーは別の作成意図として扱い、セッションが 2 件できる
	/*
	#1785 このテストは作成 API を **わざと 503 にする**（下の «1 発目は…» のスタブ）。
	そうするとブラウザ自身が

	    Failed to load resource: ... 503 ... [/v1/dish-category-group-votes]

	を console error として必ず出し、REL-08 の «console error があれば失敗» ゲートが拾う。
	アプリの不具合ではなく **テストの仕掛けそのもの**である。

	⚠️ 全 spec 共通の `KNOWN_CONSOLE_NOISE` へは入れないこと。作成 API の 503 を
	どの spec でも見逃すことになり、«本当に落ちている» を検知できなくなる。
	*/
	test.describe("作成 API がわざと 503 を返すとき", () => {
		test.use({ allowedConsoleErrors: ["/v1/dish-category-group-votes"] });

		test("失敗後にもう一度押すと、同じ idempotencyKey で再送する", async ({ appPage }) => {
			const searchPage = new SearchPage(appPage);
			const dishCategoriesPage = new DishCategoriesPage(appPage);

			await searchPage.typeLocation("渋谷");
			await searchPage.selectLocationSuggestion(0);
			await searchPage.submitButton.click();
			await dishCategoriesPage.expectLoaded();

			const sentKeys: (string | undefined)[] = [];
			await appPage.route(CREATE_URL_GLOB, async (route) => {
				if (route.request().method().toUpperCase() !== "POST") {
					await route.continue();
					return;
				}
				sentKeys.push(idempotencyKeyOf(route));
				if (sentKeys.length === 1) {
					// 1 発目は「サーバーまでは届いたが応答が返らなかった」状況の代用
					await fulfillEnvelope(route, 503, { success: false, message: "e2e-1507 forced failure" });
					return;
				}
				await fulfillEnvelope(route, 201, {
					success: true,
					data: { id: "00000000-0000-4000-8000-000000001507", shareToken: "e2e1507sharetoken" },
				});
			});

			await expect(dishCategoriesPage.groupVoteButton).toBeVisible();
			await dishCategoriesPage.groupVoteButton.click();
			await expect.poll(() => sentKeys.length, { timeout: 30_000 }).toBe(1);

			// 失敗しても画面に留まり、もう一度押せる（#1205 の finally / catch による解除）
			await expect(dishCategoriesPage.groupVoteButton).toBeEnabled({ timeout: 30_000 });
			await dishCategoriesPage.groupVoteButton.click();
			await expect.poll(() => sentKeys.length, { timeout: 30_000 }).toBe(2);

			expect(sentKeys[0], "冪等キーが送られていない（サーバー側の冪等化が一切効かない）").toMatch(UUID_V4);
			expect(sentKeys[1], "再送で冪等キーが作り直されている（サーバーは別の作成意図として 2 件目を作る）").toBe(
				sentKeys[0],
			);
		});
	});

	// ─ テストケース②: 同じキーの再送で、サーバーが同じセッションを返す ─
	//
	// ⚠️ **#1507 の migration（idempotency_key 列 + 複合 UNIQUE index）が dev へ適用されるまで
	//    このテストは通らない**。適用前は列が無く、作成そのものが失敗する。
	//
	// ## dev DB への影響（重要）
	// 実 API を叩くため **dev DB に投票セッションが 1 件積み上がる**（削除導線は無い）。
	// 冪等化が壊れている場合は 2 件になり、それがこのテストの失敗そのものである。
	// 作成リクエストの中身は検索結果の候補スナップショットで `[E2E]` のような目印を混ぜられない
	// （dishCategories-group-vote-double-tap.spec.ts と同じ制約）。追跡が要る場合は実行時刻と
	// ホストの匿名ユーザー id で辿ること。`RUN_MUTATION=1` を明示したときだけ実行される。
	//
	// 手順:
	//   1. 検索してトピック提案画面まで進む
	//   2. 作成 API を傍受し、**1 発目は本物のサーバーへ通したうえで応答だけを落とす**
	//      （`route.fetch()` で実行 → shareToken を控える → `route.abort()`）。
	//      これがオフライン復帰やプロキシ再送で起きている「サーバーには届いている」状況
	//   3. 画面はエラーになるので、ユーザーとしてもう一度「友達投票開始」を押す
	//   4. 2 発目は素通しし、レスポンスの shareToken を控える
	//   5. **2 つの shareToken が一致する**ことを検証
	//      = 2 発目で新しいセッションが作られていない（＝ DB に 1 件しかない）
	test("応答が失われた再送でも、サーバーは同じ shareToken を返す（セッションは 1 件） @mutation", async ({
		appPage,
	}) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();

		const sentKeys: (string | undefined)[] = [];
		const shareTokens: string[] = [];

		await appPage.route(CREATE_URL_GLOB, async (route) => {
			if (route.request().method().toUpperCase() !== "POST") {
				await route.continue();
				return;
			}
			sentKeys.push(idempotencyKeyOf(route));

			// 本物のサーバーへ実行する。ここで DB へのセッション作成は**実際に起きる**
			const response = await route.fetch();
			const body = (await response.json()) as { data?: { shareToken?: string } };
			if (body.data?.shareToken) shareTokens.push(body.data.shareToken);

			if (shareTokens.length === 1) {
				// 1 発目: 作成は成功しているが、応答だけがユーザーに届かなかったことにする
				await route.abort("connectionreset");
				return;
			}
			await route.fulfill({ response });
		});

		await expect(dishCategoriesPage.groupVoteButton).toBeVisible();
		await dishCategoriesPage.groupVoteButton.click();
		await expect.poll(() => shareTokens.length, { timeout: 60_000 }).toBe(1);

		// 応答が落ちたのでアプリはエラー扱い。ユーザーはもう一度押す
		await expect(dishCategoriesPage.groupVoteButton).toBeEnabled({ timeout: 30_000 });
		await dishCategoriesPage.groupVoteButton.click();
		await expect.poll(() => shareTokens.length, { timeout: 60_000 }).toBe(2);

		expect(sentKeys[1], "再送で冪等キーが変わっている").toBe(sentKeys[0]);
		expect(shareTokens[1], "再送で別の投票セッションが作られている（shareToken が違う = 2 件できた）").toBe(
			shareTokens[0],
		);
	});
});
