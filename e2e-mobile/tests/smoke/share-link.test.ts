import { by, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { APP_SCHEME } from "../../utils/locale";
import { createShareLinkToken } from "../../utils/shareLink";

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
 * ## 「実在する共有リンク」を作る（当初は避けていた）
 * 最初は dev DB への書き込みを避けたくて **解決できないトークン**で書いていたが、
 * それでは「捨てられた」と「受け取って解決に失敗した」を区別できない（どちらもホームへ着地する）。
 * 区別できる唯一の観測点だった «途中の解決画面» は速すぎて取り逃がす（下の JSDoc 参照）。
 *
 * そこで `POST /v1/share-links` で実在するリンクを 1 本作り、**着地先**を観測する。
 * 共有リンクは API 経由でしか作れない（`preview_title` / `preview_image_path` を
 * サーバ側 Resolver が作るため DB を直接いじる代替がない）。e2e-web の
 * `tests/share/share-link-ogp.spec.ts` も同じことをしている。
 * 追記されるのは共有リンク 1 行だけで他のテストと共有する状態は作らないため、@smoke に置いたままにする。
 *
 * 解決結果 → 遷移先の変換そのものは `app-expo/lib/shareLinkRoute.test.ts` が固定している。
 */
describe("共有リンクからの起動 @smoke", () => {
	/**
	 * 形は正しいが実在しない共有トークン。
	 *
	 * ⚠️ 形を崩さないこと。`toInAppPath` は token の形まで見て弾くので、
	 * 崩すと「捨てられた」のか「弾かれた」のか区別できないテストになる。
	 */
	const WELL_FORMED_TOKEN = "s1_0123456789abcdefghijkl";

	/**
	 * ⚠️ **解決画面を観測点にしないこと。** ここを踏み外して 2 度 CI を赤くした。
	 *
	 * `app/s/[token].tsx` は mount した瞬間に resolve を投げ、返ってきたら即 `router.replace` する。
	 * つまり `share-link-resolver` が出ているのは **resolve の往復の間だけ**で、実測で数秒。
	 * Detox は「アプリが idle になってから」matcher を評価するため **原理的に取り逃がす**
	 * （`waitForReady` を外し `toExist` にしても 25 秒待って落ちた）。
	 *
	 * ⚠️ `device.setURLBlacklist` で直そうとしないこと。あれは «実行中のアプリへの invoke» なので
	 * `beforeAll`（まだアプリを起動していない）では届かず suite ごと落ちる。実際に落とした。
	 * そもそも赤い run のログで Detox は待機中に「The app seems to be idle」と出しており、
	 * 同期機構は往復をブロックしていない。原因は «速すぎる» ことだけである。
	 *
	 * ## だから «実在する共有リンク» を使う
	 * 解決できないトークンでは「捨てられた」と「受け取って解決に失敗した」を区別できない
	 * （どちらもホームへ着地する）。実在するリンクなら着地先そのものが変わる:
	 *
	 * - 捨てられた → ホーム（検索タブ）
	 * - 受け取れた → 投稿画面（`posts-screen`）
	 *
	 * 着地先は過渡状態ではなく **留まる状態**なので、待てば必ず観測できる。
	 */

	/** この spec 用に作る実在の共有リンク（dish_media を 1 件指す） */
	let realToken: string;

	beforeAll(async () => {
		realToken = await createShareLinkToken();
		// 推薦 + 検索 + 作成の 3 往復。カテゴリが 0 件なら次を試すので長めに取る
	}, 300_000);

	// ─ テストケース: 実在する /s/:token で起動すると、その行き先まで届く ─
	// 手順:
	//   1. 実在する dish_media を指す共有リンクを API で作る（beforeAll）
	//   2. "nanitabeyo:///s/<token>" から直接起動する（ロケールセグメントを持たない URL）
	//   3. 投稿画面（posts-screen）が表示されることを検証
	//
	// 修正前はここで検索タブ（ホーム）が出る。つまりこのアサーションが
	// 「ディープリンクが捨てられていない」ことの直接の証拠になる
	it("ロケールを持たない /s/:token でもホームへ落ちず、共有先まで届く", async () => {
		await launchAppWithSession({ as: "anon", url: `${APP_SCHEME}:///s/${realToken}` });

		await waitUntilVisible(by.id("posts-screen"));
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

		// deep-link.test.ts と同じ観測点。ここへ来ていれば「解決画面で固まっていない」ことが言える。
		// ⚠️ ここで解決画面を先に待たないこと。速すぎて取り逃がすだけで、理由の無い flaky になる
		await waitUntilVisible(by.id("search-header-title"));
	});
});
