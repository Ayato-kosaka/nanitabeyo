import { test as base, expect, type Page } from "@playwright/test";
import { waitForAnonymousSession } from "../utils/auth";
import { seedDishCategoriesTutorialAsSeen, seedTutorialAsSeen } from "../utils/storage";

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
	 * オンボーディング（#1486）の「表示済み」フラグを事前シードするか。
	 * ja-JP では初回訪問時にオンボーディング画面へ自動遷移して操作を妨げるため既定 true。
	 * オンボーディング自体をテストする spec だけ `test.use({ seedTutorialSeen: false })` で無効化する。
	 *
	 * ⚠️ 名前に `Tutorial` が残っているのは、**ストレージキーを旧チュートリアルから
	 * 変えていない**ため（#1486 §3。変えると既読の既存ユーザー全員へ再表示される）。
	 */
	seedTutorialSeen: boolean;
	/**
	 * 料理提案画面のスポットライトチュートリアルを表示済みにするか。
	 * 既存の検索フローを遮らないよう既定true、専用specのみfalseにする。
	 */
	seedDishCategoriesTutorialSeen: boolean;
	/**
	 * この spec では «出て当然» の console error / pageerror。**部分一致**したものは収集しない。
	 *
	 * `KNOWN_CONSOLE_NOISE` との違いは **適用範囲** である。あちらは «どの spec でも無害» な
	 * ノイズ用で、ここは «その spec の前提そのものがエラーを生む» 場合に使う。
	 * hydration 失敗（React error #418）のような検知したい種類のエラーを
	 * `KNOWN_CONSOLE_NOISE` へ入れると **全 spec で見えなくなる**ので、必ずこちらを使い、
	 * `test.use()` の直近に «なぜ出て当然なのか» を書くこと。
	 *
	 * ⚠️ **正規表現の配列にしないこと。** Playwright はフィクスチャ値が
	 * `Array.isArray(value) && typeof value[1] === "object"` を満たすと «[値, オプション]» の
	 * タプルとみなす（playwright/lib の `isFixtureTuple`）。`RegExp` は object なので
	 * `test.use({ allowedConsoleErrors: [/a/, /b/] })` は 2 要素目をオプション扱いで剥がされ、
	 * 値が配列でなくなって実行時に `allowedConsoleErrors.some is not a function` で落ちる
	 *（run 32718781438 で実測）。文字列なら `typeof value[1] === "string"` なのでこの罠を踏まない。
	 */
	allowedConsoleErrors: string[];
};

/** テストへ提供するフィクスチャ */
type AppFixtures = {
	/**
	 * 収集された console error / pageerror のメッセージ一覧。
	 * auto フィクスチャの teardown で `toEqual([])` を検証しており、収集された時点で
	 * spec 側が何も書かなくてもテストは失敗する（REL-08）。テスト内で明示的に参照して
	 * メッセージをカスタマイズしたい場合や、途中経過を見たい場合のために公開している。
	 *
	 * ⚠️ `page` に依存しない spec（`@playwright/test` を直接 import するもの。
	 * 例: `tests/smoke/vote-share-ogp.spec.ts`）はこのフィクスチャ自体を経由しないため、
	 * console error は収集されない。理由はそちらのファイル冒頭のコメントを参照。
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
	seedDishCategoriesTutorialSeen: [true, { option: true }],
	allowedConsoleErrors: [[], { option: true }],

	// ── context: オンボーディング / スポットライトのシードを適用 ──
	// addInitScript はページ生成前に仕込む必要があるため context を拡張する
	context: async ({ context, seedDishCategoriesTutorialSeen, seedTutorialSeen }, use) => {
		if (seedTutorialSeen) {
			await seedTutorialAsSeen(context);
		}
		if (seedDishCategoriesTutorialSeen) {
			await seedDishCategoriesTutorialAsSeen(context);
		}
		await use(context);
	},

	// ── consoleErrors: 自動収集（auto） ─────────────────────────
	consoleErrors: [
		async ({ page, allowedConsoleErrors }, use, testInfo) => {
			const errors: string[] = [];
			const isIgnored = (text: string) =>
				KNOWN_CONSOLE_NOISE.some((pattern) => pattern.test(text)) ||
				allowedConsoleErrors.some((allowed) => text.includes(allowed));

			// console.error と未捕捉例外 (pageerror) の両方を収集する
			page.on("console", (message) => {
				if (message.type() === "error" && !isIgnored(message.text())) {
					errors.push(message.text());
				}
			});
			page.on("pageerror", (error) => {
				if (!isIgnored(error.message)) {
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

			// REL-08: spec が明示的にアサートしていなくても、収集された console error /
			// pageerror があれば既定で失敗させる。個別の spec で `expect(consoleErrors).toEqual([])`
			// を書く必要はもう無い（書いても二重にはなるが害は無い）。
			expect(
				errors,
				"想定外の console error / pageerror が検出された（詳細は添付の console-errors.txt を参照。" +
					"既知のノイズなら KNOWN_CONSOLE_NOISE へ理由付きで追加すること）",
			).toEqual([]);
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
