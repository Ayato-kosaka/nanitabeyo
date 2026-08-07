import { by, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { APP_SCHEME } from "../../utils/locale";

/**
 * 🔗 共有リンク `/s/:token` からの起動（#721）@smoke
 *
 * 目的: **アプリを入れている端末で共有リンクを踏んだとき、行き先が捨てられないこと**を保証する。
 *       対応する e2e-web: e2e-web/tests/share/share-link-ogp.spec.ts（あちらは「クローラから
 *       OGP が読めるか」、こちらは「アプリが受け取れるか」で、守る対象が違う）。
 *
 * ## なぜここを守るのか（#721 で実際に見つかった欠陥）
 * `app/index.tsx` の `toInAppPath()` は、先頭セグメントが BCP 47 のロケール
 * （`/^[a-zA-Z]{2,3}(-...)*$/`）でないとディープリンクを **捨てる**。
 * `/s/<token>` の先頭は `s`（1 文字）で一致しないため、修正前は
 * 「リンクは届いているのに端末ロケールのホームへ replace される」状態だった。
 *
 * Universal Links は `/*`（`public/.well-known/apple-app-site-association`）、
 * App Links は `pathPrefix: "/"`（`app.config.ts`）なので、**共有リンクは確実にアプリへ来る**。
 * 受け側が捨てているだけ、という気づきにくい壊れ方をする。しかも SSR preview は
 * 「未インストール / PC / crawler」しか見ないので、Web だけ見ていると気づけない。
 *
 * 判定そのものは `app-expo/lib/deepLinkTarget.test.ts` が純関数として全分岐を固定している。
 * ここで見るのは **その判定が実際の起動経路に効いているか**（ルーティングまで込みの結合）。
 *
 * ## なぜ「実在する共有リンク」を作らないのか
 * 実在トークンを使うには dev DB へ 1 行 INSERT する必要があり、@smoke の階層
 *（読み取りのみ・全ブラウザ相当で回す層）から外れてしまう。
 * ここで守りたい不変条件は「`/s/...` が **捨てられずに解決画面まで届く**」ことなので、
 * 解決に失敗するトークンでも成立する（解決画面は必ず 1 度描画される）。
 * 解決結果の遷移先は `app-expo/lib/shareLinkRoute.test.ts` が固定している。
 */
describe("共有リンクからの起動 @smoke", () => {
	/**
	 * 形は正しいが実在しない共有トークン。
	 *
	 * ⚠️ 形を崩さないこと。`toInAppPath` は token の形まで見て弾くので、
	 * 崩すと「捨てられた」のか「弾かれた」のか区別できないテストになる。
	 */
	const WELL_FORMED_TOKEN = "s1_0123456789abcdefghijkl";

	// ─ テストケース: /s/:token で起動すると解決画面まで届く ─
	// 手順:
	//   1. "nanitabeyo:///s/s1_..." を組み立てる（ロケールセグメントを持たない URL）
	//   2. そのディープリンクから直接起動する
	//   3. 共有リンク解決画面（share-link-resolver）が描画されることを検証
	//
	// 修正前はここで検索タブ（ホーム）が出る。つまりこのアサーションが
	// 「ディープリンクが捨てられていない」ことの直接の証拠になる
	it("ロケールを持たない /s/:token でもホームへ落ちず、解決画面まで届く", async () => {
		await launchAppWithSession({ as: "anon", url: `${APP_SCHEME}:///s/${WELL_FORMED_TOKEN}` });

		await waitUntilVisible(by.id("share-link-resolver"));
	});

	// ─ テストケース: 解決に失敗しても白い画面で止まらない ─
	// 手順:
	//   1. 実在しないトークンで起動する
	//   2. 解決が 404 になったあと、検索画面（ホーム）へ落ちることを検証
	//
	// 共有リンクは «アプリを初めて触る人» が踏む導線なので、
	// 解決できないときに解決画面で固まるのが一番損失が大きい
	it("解決できないトークンではホームへ落とす（解決画面で固まらない）", async () => {
		await launchAppWithSession({ as: "anon", url: `${APP_SCHEME}:///s/${WELL_FORMED_TOKEN}` });

		await waitUntilVisible(by.id("share-link-resolver"));
		// deep-link.test.ts と同じ観測点。ここへ来ていれば「固まっていない」ことが言える
		await waitUntilVisible(by.id("search-header-title"));
	});
});
