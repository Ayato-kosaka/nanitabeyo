import { test as base, expect, type Page } from "@playwright/test";
import { waitForAnonymousSession } from "../utils/auth";
import { seedTutorialAsSeen } from "../utils/storage";

/**
 * 🧩 カスタムフィクスチャ
 *
 * すべての spec はこのファイルから `test` / `expect` を import すること。
 * （@playwright/test を直接 import すると、ここで定義した前提状態のシードや
 *   コンソールエラー収集が効かなくなる）
 */

/** テスト側から挙動を切り替えられるオプション */
type AppOptions = {
	/**
	 * 検索チュートリアルの「表示済み」フラグを事前シードするか。
	 * ja-JP では初回訪問時にチュートリアルが自動表示されて操作を妨げるため既定 true。
	 * チュートリアル自体をテストする spec だけ `test.use({ seedTutorialSeen: false })` で無効化する。
	 */
	seedTutorialSeen: boolean;
};

/** テストへ提供するフィクスチャ */
type AppFixtures = {
	/**
	 * 収集された console error / pageerror のメッセージ一覧。
	 * 現状はソフト運用（自動で fail しない）。テスト内で明示的にアサートしたい場合に参照する。
	 * 全テストでハード化する場合は、auto フィクスチャ末尾の attach 後に
	 * `expect(consoleErrors).toEqual([])` を追加すればよい。
	 */
	consoleErrors: string[];

	/**
	 * 「トップページを開き、/ja-JP へのリダイレクトと匿名セッション確立まで完了した」状態の Page。
	 * API 呼び出しを伴うテストはこのフィクスチャを使うことで JWT 未取得によるフレークを防げる。
	 */
	appPage: Page;
};

/**
 * 既知のノイズ（テスト失敗と無関係な console error）の許容リスト。
 * ここに一致するメッセージは consoleErrors に収集しない。
 * 追加する際は「なぜ無害なのか」をコメントで必ず説明すること。
 */
const KNOWN_CONSOLE_NOISE: RegExp[] = [
	// AuthProvider の匿名サインイン完了(=アクセストークン取得)より前に
	// 画面表示イベントのログ送信が走ることがあり、その際に一時的に出るエラー。
	// 実際の動作には影響しない(ログ送信のリトライ/破棄のみ)ため許容する。
	/Failed to log event .*Supabase access_token is missing/,

	// ヘッドレスブラウザには実位置情報が無いため navigator.geolocation が失敗するが、
	// アプリ側にフォールバック処理があり体験上は問題にならない(useLocationSearch 参照)。
	/GeolocationPositionError/,
];

export const test = base.extend<AppOptions & AppFixtures>({
	// ── オプション ──────────────────────────────────────────────
	seedTutorialSeen: [true, { option: true }],

	// ── context: チュートリアルシードを適用 ─────────────────────
	// addInitScript はページ生成前に仕込む必要があるため context を拡張する
	context: async ({ context, seedTutorialSeen }, use) => {
		if (seedTutorialSeen) {
			await seedTutorialAsSeen(context);
		}
		await use(context);
	},

	// ── consoleErrors: 自動収集（auto） ─────────────────────────
	consoleErrors: [
		async ({ page }, use, testInfo) => {
			const errors: string[] = [];

			// console.error と未捕捉例外 (pageerror) の両方を収集する
			page.on("console", (message) => {
				if (message.type() === "error" && !KNOWN_CONSOLE_NOISE.some((pattern) => pattern.test(message.text()))) {
					errors.push(message.text());
				}
			});
			page.on("pageerror", (error) => {
				if (!KNOWN_CONSOLE_NOISE.some((pattern) => pattern.test(error.message))) {
					errors.push(`[pageerror] ${error.message}`);
				}
			});

			await use(errors);

			// 収集したエラーをレポートに添付する（失敗調査の手がかりとして常に残す）
			if (errors.length > 0) {
				await testInfo.attach("console-errors.txt", {
					body: errors.join("\n\n"),
					contentType: "text/plain",
				});
			}
		},
		{ auto: true },
	],

	// ── appPage: 起動完了済みページ ─────────────────────────────
	appPage: async ({ page }, use) => {
		await page.goto("/");
		// app/index.tsx が navigator.language からロケールを解決してリダイレクトする。
		// ブラウザロケールは ja-JP に固定しているが、解決結果は "ja" / "ja-JP" の両方がありうるため両対応で待つ
		await page.waitForURL(/\/ja(-JP)?(\/|$)/);
		// AuthProvider の匿名サインイン完了（= API を叩ける状態）を待つ
		await waitForAnonymousSession(page);
		await use(page);
	},
});

export { expect };
