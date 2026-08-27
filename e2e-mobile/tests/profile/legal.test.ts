import { strict as assert } from "node:assert";

import { device, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { LegalScreen } from "../../screens/LegalScreen";

/**
 * 📜 法務ドキュメント画面のテスト（e2e-web の tests/profile/legal.spec.ts に対応）
 *
 * 目的: 「法務文書は URL で指せる単独ページ」という #1368 の目的を実端末で保証する。
 *
 * ## ネイティブで最も重要なのはハードウェアバック
 * #1359 のログインと同じ構図。BlurModal は自前の BackHandler
 *（`app-expo/features/blurModal/hooks/useBlurModal.tsx`）で戻るキーを握っており、
 * 「表示状態が遷移と無関係な boolean」であることが #498 の根だった。
 * ルート化でその責務は Navigator（スタックの pop）へ移る。乗り換えが効いているかを見る唯一の形。
 *
 * ## Web との差分
 * e2e-web は `page.goto("/ja-JP/legal/terms")` で URL 直遷移し、ブラウザバックも検証できる。
 * ネイティブにはブラウザバックが無いため、ディープリンク着地 + ハードウェアバック
 *（Android）/ ヘッダーの戻るボタン（iOS）で同じ経路を見る。
 */
describe("法務ドキュメント画面", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// （fixtures/e2e.ts の launchAppWithSession）、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 設定の利用規約行から開き、戻る操作で設定へ帰る ─
	// #1368 【設計】#498 の再発検知に最も近い検証。モーダル時代はハードウェアバックを
	// useBlurModal の BackHandler が食っていた。ルート化後はスタックの pop になる。
	// ⚠️ `device.pressBack()` は Android 専用。iOS ではヘッダーの戻るボタンで同じ復帰を確認する。
	// 手順:
	//   1. マイページ→歯車で設定画面へ遷移する
	//   2. 利用規約行をタップし、法務ドキュメント画面が開くことを検証
	//   3. Android はハードウェアバック / iOS はヘッダーの戻るボタンで離脱する
	//   4. マイページへ戻ってくることを検証
	it("マイページの設定項目から開き、戻る操作でマイページへ帰る", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await tabBar.gotoProfile();
		// #1402 独立した設定画面は無くなり、リーガル 4 行はマイページの縦リストにある
		await settingsScreen.expectLoaded();

		await settingsScreen.openLegalDocument("terms");
		await legalScreen.expectOpened();

		if (device.getPlatform() === "android") {
			await device.pressBack();
		} else {
			await legalScreen.goBack();
		}

		// #1583 規約は «なに食べよについて» から開くので、戻る先もそこ
		await settingsScreen.expectAboutLoaded();
	});

	// ─ テストケース: 4 行それぞれが法務ドキュメント画面へ着く ─
	// #1368 4 行はアプリ側で同じハンドラを通るため、doc の取り違えは «行ごと» に踏まないと分からない。
	// 画面上のどの文書が出ているかまでは testID で区別できない（4 文書とも同一 UI）ので、
	// ここでは「どの行からでも画面に着けること」までを見る。doc の対応は
	// app-expo の `__tests__/legalEntryPoints.test.tsx` が push 引数で固定している。
	// 手順:
	//   1. マイページを表示する
	//   2. ガイドライン / 著作権の行をタップし、法務ドキュメント画面が開くことを検証
	//   3. 戻って次の行を試す
	it("ガイドライン・著作権の行からも同じ画面へ着く", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await tabBar.gotoProfile();
		// #1402 独立した設定画面は無くなり、リーガル 4 行はマイページの縦リストにある
		await settingsScreen.expectLoaded();

		for (const doc of ["guidelines", "copyright"] as const) {
			await settingsScreen.openLegalDocument(doc);
			await legalScreen.expectOpened();

			await legalScreen.goBack();
			// #1583 戻る先は «なに食べよについて»。次の周回のためマイページまで戻す。
			// ⚠️ ここで `legalScreen.goBack()` を呼んではいけない。あちらが押すのは
			//    `legal-screen-back` で、**この画面には存在しない**（about は `about-screen-back`）。
			//    実機に投げる前にこの取り違えを 1 度書いてしまったので、helper 経由に固定する。
			await settingsScreen.expectAboutLoaded();
			await settingsScreen.goBackFromAbout();
			await settingsScreen.expectLoaded();
		}
	});

	// ─ テストケース: ディープリンクで直接着地できる ─
	// #1368 【設計】sitemap に載せた URL・ストア審査・問い合わせメールからの着地がこれ。
	// モーダルへ戻す変更を入れると URL では開けなくなり、ここが落ちる。
	// 手順:
	//   1. nanitabeyo:///ja-JP/legal/terms へ直接着地する
	//   2. 法務ドキュメント画面が表示されることを検証
	//   3. ヘッダーの戻るボタンで離脱し、履歴が無いのでマイページへ倒れることを検証
	//      （#1402 以前は設定画面へ倒れていた。その画面が無くなったので行き先が変わった）
	it("ディープリンクで直接着地でき、戻るとマイページへ倒れる", async () => {
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink("legal/terms"),
			// タブバー（tab-search）は法務ドキュメント画面の下に居ないため、既定の起動完了待ちは使えない
			waitForReady: false,
		});
		await legalScreen.expectOpened();

		await legalScreen.goBack();

		await settingsScreen.expectLoaded();
	});

	// ─ テストケース: 公開していない doc は not-found へ倒れる ─
	// ⚠️ ここが「既定の文書を出す」実装に変わると、`/legal/<任意の文字列>` が全部
	//    同じ文書の複製として 200 を返す（app-expo/lib/legalRoute.ts）。本文が «出ていない» ことまで見る
	// 手順:
	//   1. nanitabeyo:///ja-JP/legal/tos（存在しない文書）へ直接着地する
	//   2. not-found 表示が出ることを検証
	//   3. 本文コンテナ（legal-screen-document）が存在しないことを検証
	it("公開していない doc は not-found を出し、既定の文書へ倒れない", async () => {
		const legalScreen = new LegalScreen();

		await launchAppWithSession({ as: "anon", url: localeDeepLink("legal/tos"), waitForReady: false });
		await legalScreen.expectNotFound();

		const hasDocument = await legalScreen.hasDocument();
		assert.equal(hasDocument, false, "公開していない doc では legal-screen-document を描かないはず");
	});
});
