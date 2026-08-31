import { test as base, expect, type Page } from "@playwright/test";
import { waitForAnonymousSession } from "../utils/auth";
import { seedDishCategoriesTutorialAsSeen, seedMyDishesTutorialAsSeen, seedTutorialAsSeen } from "../utils/storage";

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
	 * #1629「食べたい/食べた」画面のスポットライトチュートリアルを表示済みにするか。
	 * 画面全体を覆うオーバーレイなので、既定 true。専用 spec のみ false にする。
	 */
	seedMyDishesTutorialSeen: boolean;
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

	/*
	#1629 `.invalid` ドメインの読み込み失敗。

	`.invalid` は RFC 2606 が «決して解決してはならない» と定めた予約 TLD で、
	**製品コードがこのホストを引くことは構造上ありえない**。出てくるのは、画像の実体を
	用意せずに «URL があるときの描画» を見たいテストのスタブ（`example.invalid/xxx.jpg` 等）
	だけである。したがってこれを全 spec で無視しても、検知したい不具合は 1 つも隠れない。

	⚠️ 逆に、無視しないと **画像 URL を含むスタブを置いた spec が軒並み落ちる**。
	実際にこれで main が 1 週間赤く、失敗 81 件のうち最多の一群がこれだった。
	個別 spec の `allowedConsoleErrors` へ同じ 1 行を 10 ファイルへ配るより、
	«ありえないホスト» という性質でまとめて切るほうが陳腐化しない。

	URL は本文に含まれないので、`page.on("console")` 側で付けた `[<url>]` を見る。
	*/
	/\[https?:\/\/[^\]]*\.invalid[:/][^\]]*\]/,

	/*
	#1629 ベクター地図が使えずラスターへ落ちたときの通知。

	Google Maps JS は WebGL でベクター地図を描こうとし、失敗するとラスターへ
	自動で切り替えたうえで **console.error として** その旨を出す。CI のヘッドレス
	Chromium には GPU が無いので、地図を出す spec では必ず出る。
	地図そのものは（ラスターで）正しく描かれるため、体験にも検証にも影響しない。
	環境の性質であって、アプリ側で消せるものではない。
	*/
	/Attempted to load a Vector Map, but failed\. Falling back to Raster/,

	/*
	#1629 dev の CDN が返す固定の `Access-Control-Allow-Origin` と、
	e2e-web の配信ポートが噛み合わないことによる CORS ブロック。

	`infra/url-map/urlmap-cdn.nanitabeyo.net.yaml` の `/development/` は
	`Access-Control-Allow-Origin: http://localhost:8083` を **固定値で** 付けている
	（`responseHeadersToAdd` はリクエストの Origin を反射できない）。
	e2e-web の静的サーバは `http://localhost:4173` なので、CORS モードで CDN の
	画像を引く経路が必ずブロックされる。**ポートを 8083 へ合わせても解決しない**
	（今度は API 側の `CORS_ORIGIN` が 4173 / 8081 しか許可していないので API が全滅する）。

	つまりこれは «dev の配信設定が、実際に使われているどのポートとも一致していない»
	という infra 側の食い違いであり、テストコードでは直せない。
	ホストとパスを `development` に限って狭く無視する。production の配信
	（`https://app.nanitabeyo.net`）は正しい値が入っており、この行に一致しない。
	*/
	/^Access to fetch at 'https:\/\/cdn\.nanitabeyo\.net\/development\//,
	/Failed to load resource: net::ERR_FAILED \[https:\/\/cdn\.nanitabeyo\.net\/development\//,
];

export const test = base.extend<AppOptions & AppFixtures>({
	// ── オプション ──────────────────────────────────────────────
	seedTutorialSeen: [true, { option: true }],
	seedDishCategoriesTutorialSeen: [true, { option: true }],
	seedMyDishesTutorialSeen: [true, { option: true }],
	allowedConsoleErrors: [[], { option: true }],

	// ── context: オンボーディング / スポットライトのシードを適用 ──
	// addInitScript はページ生成前に仕込む必要があるため context を拡張する
	context: async ({ context, seedDishCategoriesTutorialSeen, seedMyDishesTutorialSeen, seedTutorialSeen }, use) => {
		if (seedTutorialSeen) {
			await seedTutorialAsSeen(context);
		}
		if (seedDishCategoriesTutorialSeen) {
			await seedDishCategoriesTutorialAsSeen(context);
		}
		if (seedMyDishesTutorialSeen) {
			await seedMyDishesTutorialAsSeen(context);
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

			/*
			#1629 ⚠️ **メッセージ本文だけを記録しないこと。**

			リソースの読み込み失敗はブラウザが
			`Failed to load resource: net::ERR_NAME_NOT_RESOLVED` としか書かない。
			**どの URL が失敗したのかが本文に入っていない**ため、
			この 1 行だけを添付しても «何を直せばいいのか» が誰にも分からない。
			実際に main が 1 週間赤いあいだ、この形の失敗が最多（116 件）を占めていながら、
			ログからは原因の特定が不可能だった。

			`ConsoleMessage.location()` には失敗したリソースの URL が入るので、
			本文に無いときだけ URL を添えて記録する。
			*/
			page.on("console", (message) => {
				if (message.type() !== "error") return;
				const text = message.text();
				const url = message.location()?.url;
				// 判定は «URL を足した後» のテキストへ掛ける。許容リストは部分一致なので
				// 足しても既存の指定は当たり続け、URL でしか区別できないノイズも書けるようになる
				const enriched = url && !text.includes(url) ? `${text} [${url}]` : text;
				if (isIgnored(enriched)) return;
				errors.push(enriched);
			});
			/*
			#1629 ⚠️ **`message` だけを記録しないこと。**

			ページが Error ではない値を throw すると、Playwright の `error.message` は
			`"Object"` にしかならない（実測: main の失敗ログに `[pageerror] Object` が 17 件）。
			それだけでは «どこで何が投げられたのか» が一切分からないので、
			スタックの先頭 1 行（発生源のファイルと位置）を添える。
			*/
			page.on("pageerror", (error) => {
				const where = error.stack
					?.split("\n")
					.map((line) => line.trim())
					.find((line) => line.startsWith("at "));
				const text = where ? `[pageerror] ${error.message} (${where})` : `[pageerror] ${error.message}`;
				if (!isIgnored(text)) {
					errors.push(text);
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
