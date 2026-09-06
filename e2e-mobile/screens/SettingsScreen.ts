import { DEFAULT_TIMEOUT, by, element, existsNow, tapWhenVisible, waitFor, waitUntilVisible } from "../fixtures/e2e";

/**
 * 設定画面から開ける法務ドキュメント（#1368）。
 * 値は `app-expo/lib/legalRoute.ts` の `LEGAL_DOCUMENT_TYPES` と対応する（URL の `doc` セグメント）。
 */
export type LegalDocumentKey = "guidelines" | "terms" | "privacy" | "copyright";

/**
 * #1509 表示テーマの 3 択。
 * app-expo/contexts/ThemeProvider.ts の `ThemePreference` / `THEME_PREFERENCES` と一致させること。
 */
export type ThemePreferenceKey = "system" | "light" | "dark";

/**
 * ⚙️ 設定項目の Screen Object（e2e-web の pages/SettingsPage.ts に対応）
 * #1402 で «設定画面» は無くなり、項目はマイページ本体（profile/index.tsx）へ統合された。
 * testID は据え置きなので、この Screen Object の識別子はそのまま使える。
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx（マイページ本体）
 *
 * #1402 で **独立した設定画面（profile/settings.tsx）は無くなり**、その項目は
 * マイページの縦リストへ統合された（歯車ボタンも消えた）。«設定という画面» は消えたが
 * «設定という項目群» はそのまま残っているので、この Screen Object と `settings-*` の
 * testID は据え置いてある。マイページ側の要素は `screens/ProfileScreen.ts` が持つ。
 *
 * - 「レビューを書く」（ストア誘導・settings-leave-review）は Web では非表示（`Platform.OS !== "web"` 条件）だが、
 *   ネイティブでは表示される（#1031 §1-1 の反転分類）。
 *   #1031 【設計確定】M2: 共有 dev 環境・外部ストアへの書き込みを避けるため、このボタンは
 *   **表示のみ検証しタップしない**（タップすると実際に Linking.openURL が走り外部アプリへ遷移してしまう）。
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示。
 *   匿名側（非表示）は tests/profile/settings.test.ts、実行そのものは tests/authenticated/logout.test.ts が検証する。
 * - #1368 リーガル 4 行はモーダル起動ではなく `/[locale]/legal/<doc>` への画面遷移になった。
 *   遷移先の検証は screens/LegalScreen.ts が持つ。
 */
export class SettingsScreen {
	/** ご意見・不具合（フィードバック）行（既存 testID） */
	/** マイページ最上段の «いいねした投稿»。初期表示で必ず見えているので «描画完了» の目印に使う */
	readonly likedItem = by.id("profile-liked");
	readonly feedbackItem = by.id("settings-feedback");
	/** レビューを書く（ストア誘導）行。ネイティブのみ表示（既存 testID） */
	/**
	 * «なに食べよ を応援する»（ストア誘導）行。ネイティブのみ表示（testID は据え置き）。
	 * #1583 でラベルが «レビューを書く» から変わり、置き場所も «なに食べよについて» ページへ移った。
	 * **マイページには無い。** `openAbout()` で移動してから触ること。
	 */
	readonly leaveReviewItem = by.id("settings-leave-review");
	/**
	 * ブロック済みの料理カテゴリ行（既存 testID）。
	 * #1132 で文言は「料理トピック」→「料理カテゴリ」へ変わったが、testID は据え置かれている。
	 */
	readonly blockedDishCategoriesItem = by.id("settings-blocked-dish-categories");
	/** 表示言語行（#1508。Card 2 の最終行として追加された） */
	readonly languageItem = by.id("settings-language");
	/**
	 * 自分が作成/参加したグループ投票の一覧行（#1505 で追加）。
	 * 対応画面: screens/MyDishCategoryGroupVotesScreen.ts
	 */
	readonly myGroupVotesItem = by.id("settings-my-group-votes");
	/** コミュニティガイドライン行（既存 testID） */
	readonly guidelinesItem = by.id("settings-guidelines");
	/** 利用規約行（既存 testID） */
	readonly termsItem = by.id("settings-terms");
	/** プライバシーポリシー行（既存 testID） */
	readonly privacyItem = by.id("settings-privacy");
	/** 著作権行（既存 testID） */
	readonly copyrightItem = by.id("settings-copyright");
	/**
	 * #1629 «アカウント管理» への遷移行（マイページ本体にある）。
	 * ログアウト行・削除行はこの先の `profile/account` にあり、マイページ本体には無い。
	 */
	readonly accountItem = by.id("settings-account");
	/**
	 * #1629 アカウント管理ページの本体（遷移が終わったかの判定に使う）。
	 *
	 * ⚠️ **`account-settings-screen` を使ってはいけない。** あれは `ScreenHeader` に
	 * 渡している «接頭辞» であって、その id を持つ要素は 1 つも描かれない。
	 * `ScreenHeader` は `${testID}-title` と `${testID}-back` しか付けない
	 * （`app-expo/components/ScreenHeader.tsx`）。実際に待って落ちた（run 34017672693）。
	 * 実体のある ScrollView を待つ。
	 */
	readonly accountScroll = by.id("account-settings-scroll");
	/** ログアウト行（ログイン済みユーザーのみ表示・既存 testID。`profile/account` にある） */
	readonly logoutItem = by.id("settings-logout");
	/**
	 * #1504 端末設定行（規約カードの直上）。
	 * トグル本体はこの行から push される端末設定画面にあり、`screens/DeviceSettingsScreen.ts` が持つ。
	 */
	readonly deviceSettingsItem = by.id("settings-device-settings");
	/** #1583 マイページ → «なに食べよについて» の行 */
	readonly aboutItem = by.id("settings-about");
	/**
	 * バージョン表示（#1495 SUP-03、既存 testID）。
	 * 対応コンポーネント: app-expo/components/VersionInfo.tsx（web/native 共通）。
	 * "{version}({短縮コミットID})" の 1 行（例: "1.14.0(abc1234)"）で描画される。
	 */
	readonly versionSection = by.id("settings-version-section");

	/*
	 #1509 表示テーマの 3 択セレクタ（システム追従 / ライト / ダーク）。
	*/
	/*
	⚠️ #1583 で **マイページから «端末設定» ページへ移った**。マイページを開いただけでは
	   見えないので、`openDeviceSettings()` で移動してから触ること。
	*/
	readonly themeSelector = by.id("settings-theme-selector");
	/**
	 * ログアウト確認ダイアログのタイトル（ja-JP: `Settings.logoutConfirmTitle`）。
	 * DialogProvider（react-native-paper の Dialog）はタイトルに testID を持たないため文字列で特定する。
	 * `title` と同じくロケール依存のセレクタなので、翻訳キーを変えたらここも直すこと。
	 */
	readonly logoutConfirmTitle = by.text("ログアウトしますか？");
	/**
	 * 確認ダイアログの「ログアウト」ボタン（#1131 で DialogProvider に既定 testID を追加）。
	 *
	 * ⚠️ `by.text("ログアウト")` は使えない。ダイアログが開いている間は
	 * **設定画面のログアウト行とダイアログのボタンが同時に存在する**ため matcher が 2 件に一致し、
	 * Detox は複数一致した要素の操作を例外にする（utils/waits.ts の `target()` 参照）。
	 */
	readonly logoutConfirmButton = by.id("dialog-confirm-button");
	/** 確認ダイアログの「キャンセル」ボタン（#1131 で追加した既定 testID） */
	readonly logoutCancelButton = by.id("dialog-cancel-button");
	/**
	 * #1511 アカウント削除行（ログイン済みユーザーのみ表示）。
	 * ログアウト行のさらに下、設定画面の最下段にある（= 初期表示では画面外にいる）。
	 */
	readonly deleteAccountItem = by.id("settings-delete-account");
	/**
	 * #1511 1 枚目（影響の説明）の確認ダイアログのタイトル（ja-JP: `Settings.deleteAccountConfirmTitle`）。
	 * DialogProvider はタイトルに testID を持たないため文字列で特定する（logoutConfirmTitle と同じ事情）。
	 */
	readonly deleteAccountConfirmTitle = by.text("アカウントを削除しますか？");
	/** #1511 2 枚目（取り消せないことへの同意）の確認ダイアログのタイトル */
	readonly deleteAccountFinalTitle = by.text("本当に削除しますか？");
	/**
	 * #1511 確認ダイアログの OK / キャンセル。`confirm()` が出すダイアログの既定 testID（#1131）。
	 *
	 * ⚠️ `logoutConfirmButton` と同じ testID を指す。**同時に 2 枚は開かない**ので衝突しないが、
	 * 1 枚目の OK を押して 2 枚目が開くまでの間はどちらの実体か曖昧になりうる。
	 * タイトルの表示を待ってから押すこと（`waitUntilVisible(deleteAccountFinalTitle)`）。
	 */
	readonly dialogConfirmButton = by.id("dialog-confirm-button");
	readonly dialogCancelButton = by.id("dialog-cancel-button");
	/**
	 * #1368 リーガル 4 行は **モーダルではなく画面遷移**（`/[locale]/legal/<doc>`）になった。
	 * 遷移先の検証は `screens/LegalScreen.ts` が持つ。
	 *
	 * ログイン画面（`/[locale]/auth/login`）の同意文言リンク（`login-privacy-link` /
	 * `login-terms-link`）からも同じ画面へ遷移できるが、あちらは `<Text>` の入れ子で
	 * ネイティブ View を持たず Detox から到達できない（理由は #1027 から変わっていない）。
	 * ネイティブでのリーガル導線の検証はこの実体のある行に集約している
	 *（screens/LoginScreen.ts 参照）。
	 */
	private readonly legalItemByDoc = {
		guidelines: this.guidelinesItem,
		terms: this.termsItem,
		privacy: this.privacyItem,
		copyright: this.copyrightItem,
	} as const;

	/**
	 * 設定項目が表示されていることを検証する。
	 *
	 * #1402 以前は ScreenHeader のタイトル「設定」（`by.text`）を見ていたが、その画面ごと無くなった。
	 * 代わりに «必ず出る行» の testID を見る。**この Screen Object からロケール依存の
	 * セレクタが 1 つ減った**（Android の端末ロケールに引きずられて落ちる経路が 1 本消えた。#1031 B4）。
	 *
	 * ## ⚠️ ここは «存在» で判定する。可視で見ても、スクロールしてもいけない
	 *
	 * 3 回の実機 run で 3 通りの落ち方をした。**原因は全部この 1 メソッド**である。
	 *
	 * | run | やっていたこと | 落ち方 |
	 * | --- | --- | --- |
	 * | 32908255134 (iOS) | `settings-feedback` まで scroll | 開始点 y=974.5 が枠外 |
	 * | 32916602453 (iOS) | 同上 + 開始点 0.5 を明示 | 開始点 y=764 でやはり枠外 |
	 * | 32924313995 (Android) | 最上段の可視を待つ（scroll せず） | **前のテストが下へスクロール済みで最上段が画面外** |
	 *
	 * «画面が描画されたか» は **スクロール位置と無関係**であるべきなので、
	 * `toExist()` で見る。可視（`toBeVisible`）で見た瞬間にスクロール位置へ依存し、
	 * スクロールで解決しようとした瞬間に開始点の問題を踏む。
	 *
	 * 行が **見えている** ことが要るテストは `expectRowVisible()` を呼ぶこと。
	 * あちらは先に `scrollTo("top")` で位置を正規化してから下向きに探す。
	 *
	 * ## 参考: かつて «見えるまでスクロール» していた経緯（#1583）
	 *
	 * ## 参考: 以前の «見えるまでスクロール» の経緯（#1583）
	 * `settings-feedback` はマイページの 3 枚目のカードにあり、**匿名だと上に大きな
	 * «ようこそ、ゲストさん» カードが入るぶん初期表示で画面外へ落ちる**
	 * （run 32849947323 の testFnFailure.png で実測。いいね／保存のカードまでで画面が終わっていた）。
	 * Detox の `toBeVisible()` は «面積の 75% 以上が可視» を要求するので、
	 * スクロールせずに待つと 25 秒待って必ず落ちる。
	 *
	 * `openDeviceSettings()` / `scrollToLogout()` が既に同じ理由で
	 * `whileElement(...).scroll()` を使っている。画面の入口であるこのメソッドだけが
	 * «初期表示で見えている» を前提にしていたので、同じ作法へ揃えた。
	 * 既に見えていればスクロールは 1 度も走らない。
	 *
	 * ⚠️ **スクロールの前に «画面がある» ことを待つこと。**
	 * `whileElement(...).scroll()` は対象コンテナの出現を **待たない**。まだ描画されて
	 * いなければ `No elements found for MATCHER(id == "settings-scroll")` で
	 * **即座に**落ちる（`waitUntilVisible` なら timeout まで待つ）。
	 * iOS の遅いランナー（1 テスト 100〜200 秒かかる回）で実測した
	 * （run 32882521476。マイページがまだ出ていないうちにスクロールへ入って落ちていた）。
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		// 1) 画面そのものの出現を待つ
		await waitFor(element(by.id("settings-scroll")))
			.toExist()
			.withTimeout(timeout);
		// 2) «描画が終わった» の判定は **可視ではなく存在**で見る。
		//    可視で見るとスクロール位置に依存して落ちる（下の JSDoc）
		await waitFor(element(this.likedItem)).toExist().withTimeout(timeout);
	}

	/** テーマ 3 択の 1 行（#1509） */
	themeOption(preference: ThemePreferenceKey) {
		return by.id(`settings-theme-${preference}`);
	}

	/**
	 * 選択中を示すチェック（選択されている行にだけ存在する・#1509）。
	 *
	 * ⚠️ `getAttributes()` で選択状態を読もうとしないこと。`accessibilityState.selected` は
	 * Android の Detox では属性として上がってこず、iOS でも取れる保証が無い。
	 * アプリ側はチェックアイコンを **素の View** で包んで testID を持たせてあるので、
	 * 「その View が居るか」で判定するのが両 OS で確実（app-expo の settings.tsx のコメント参照）。
	 */
	themeOptionCheck(preference: ThemePreferenceKey) {
		return by.id(`settings-theme-${preference}-check`);
	}

	/** テーマを選び、選択状態が切り替わるまで待つ（#1509） */
	async selectTheme(preference: ThemePreferenceKey): Promise<void> {
		await tapWhenVisible(this.themeOption(preference));
		await waitUntilVisible(this.themeOptionCheck(preference));
	}

	/** そのテーマが選択済みかを **待たずに** 判定する（hasLogoutItem と同じ考え方） */
	async isThemeSelected(preference: ThemePreferenceKey): Promise<boolean> {
		return existsNow(this.themeOptionCheck(preference));
	}

	/**
	 * バージョン行（settings-version-section）の実測テキストを読む（#1495）。
	 * `getAttributes()` の戻り値は iOS / Android で型が分かれるため、`text` だけを拾う
	 * （tests/profile/profile-tab-deep-link.test.ts と同じ絞り方）。
	 *
	 * ⚠️ #1583 でバージョンは «なに食べよについて» ページへ移った。
	 *    呼ぶ前に `openAbout()` で移動しておくこと。
	 */
	async getVersionText(): Promise<string> {
		const attributes = (await element(this.versionSection).getAttributes()) as { text?: string };
		return attributes.text ?? "";
	}

	/**
	 * ログアウト行が表示されているかを **待たずに** 判定する。
	 * 匿名/ログイン済みで可視性が変わるため、TabBar.hasNotificationsTab() と同じ考え方で使う。
	 */
	async hasLogoutItem(): Promise<boolean> {
		return existsNow(this.logoutItem);
	}

	/**
	 * 指定した文言の要素が設定画面に **無い**ことを判定する（待たずに即判定）。
	 * #1132 の「旧文言が導線側に残っていないこと」の検証に使う。
	 */
	async hasText(text: string): Promise<boolean> {
		return existsNow(by.text(text));
	}

	/**
	 * 開いている確認ダイアログの **本文に** 指定の文字列が含まれるかを見る（#1511）。
	 *
	 * ⚠️ `hasText()`（= `by.text()`）で代用しないこと。あれは要素のテキストの **完全一致**で、
	 * ダイアログ本文は段落まるごとが 1 つの Text に入る。つまり
	 * 「この操作は取り消せません。」のような **一部分では絶対に一致しない**。
	 *
	 * `tests/authenticated/account-delete.test.ts` は実際にこれで落ち続けていた
	 *（run 32916602453 の Android で実測。UI 側は正しく «この操作は取り消せません。» を
	 *  出しており、testFnFailure.png にもはっきり写っている。**テストの見方が誤り**だった）。
	 * 書いた本人が «部分一致で見る» と JSDoc に書いていたが、Detox はそうなっていない。
	 *
	 * ここでは要素の text 属性を取り出して JS 側で `includes()` する。
	 */
	async dialogMessageIncludes(text: string): Promise<boolean> {
		const attrs = (await element(by.id("dialog-message")).getAttributes()) as {
			text?: string;
			elements?: { text?: string }[];
		};
		// 複数マッチ時は elements 配列で返る（Detox の仕様）
		const bodies = attrs.elements ? attrs.elements.map((e) => e.text ?? "") : [attrs.text ?? ""];
		return bodies.some((body) => body.includes(text));
	}

	/**
	 * ブロック済みの料理カテゴリ行をタップして一覧画面へ遷移する（#1132）。
	 * e2e-web は `/ja-JP/profile/blocked-dish-categories` へ URL 直遷移するが、
	 * ネイティブには代替経路が無いため settings.test.ts と同じく実 UI 導線をタップする。
	 */
	async openBlockedDishCategories(): Promise<void> {
		await tapWhenVisible(this.blockedDishCategoriesItem);
	}

	/**
	 * 表示言語の選択画面へ遷移する（#1508）。
	 *
	 * ⚠️ この行は Card 2 の最終行で、エミュレータの画面高では初期表示から少し外れることがある。
	 * `scrollToLogout()` と同じ理由（Detox の `toBeVisible()` は面積の 75% 以上の可視を要求する）で、
	 * 見えるところまでスクロールしてから押す。既に見えていれば 1 度も動かさずに返る。
	 */
	async openLanguage(): Promise<void> {
		// #1583 コンテナの出現待ちを含む `expectRowVisible()` を通す
		//（素の whileElement(...).scroll() は «画面がまだ無い» と即死する）
		await this.expectRowVisible(this.languageItem);
		await tapWhenVisible(this.languageItem);
	}

	/**
	 * 「グループ投票の履歴」行をタップして一覧画面へ遷移する（#1505）。
	 * e2e-web は `/ja-JP/profile/dish-category-group-votes` へ URL 直遷移するが、
	 * ネイティブには代替経路が無いため settings.test.ts / openBlockedTopics と同じく実 UI 導線をタップする。
	 */
	async openMyGroupVotes(): Promise<void> {
		await tapWhenVisible(this.myGroupVotesItem);
	}

	/** プライバシーポリシー行をタップして法務ドキュメント画面へ遷移する（#1368 でモーダル起動から変更） */
	async openPrivacyPolicy(): Promise<void> {
		// #1583 規約 4 行は «なに食べよについて» ページへ移った。先に移動してから押す
		await this.openAbout();
		await tapWhenVisible(this.privacyItem);
	}

	/**
	 * 端末設定行をタップして端末設定画面へ遷移する（#1504）。
	 *
	 * ⚠️ この行は規約カードの直上（= マイページのかなり下）にあり、エミュレータの画面高では
	 * 初期表示で画面外にいることがある。`scrollToLogout()` と同じ理由で、タップ前に
	 * `whileElement(...).scroll()` で «見えるまでスクロール» してから押す
	 * （既に見えていればスクロールは 1 度も走らない）。
	 */
	/**
	 * #1583 マイページの «下のほうにある行» を、見えるところまで運んでから可視を確かめる。
	 *
	 * マイページは縦に長く、匿名だと上に大きな «ようこそ、ゲストさん» カードが入るぶん
	 * 下 2 枚のカード（端末設定 / なに食べよについて / ログアウト）は初期表示で画面外にいる。
	 * Detox の `toBeVisible()` は «面積の 75% 以上が可視» を要求するので、
	 * 素の `waitUntilVisible()` で待つと 25 秒待って必ず落ちる（run 32867585023 で実測）。
	 *
	 * 既に見えていればスクロールは 1 度も走らない。
	 */
	async expectRowVisible(matcher: Detox.NativeMatcher, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		// `expectLoaded()` と同じ理由でコンテナの出現を先に待つ（scroll() は待たない）
		await waitFor(element(by.id("settings-scroll")))
			.toExist()
			.withTimeout(timeout);
		/*
		 ⚠️ **先に一番上へ戻すこと。**
		 `whileElement(...).scroll(300, "down")` は **下向きにしか探さない**。
		 前のテストが下までスクロールした状態を引き継いでいると、目的の行が
		 «今より上» にある場合は永久に見つからず 25 秒待って落ちる
		 （run 32924313995 の Android で実測。«ご意見・不具合» が上に隠れていた）。

		 `scrollTo("top")` は **開始点を取らない**ので、iOS で 2 度踏んだ
		 «開始点が可視範囲の外» の問題（run 32908255134 / 32916602453）にも当たらない。
		 既に一番上なら Detox が «これ以上スクロールできない» と投げるので、そこは握る。
		*/
		await element(by.id("settings-scroll"))
			.scrollTo("top")
			.catch(() => undefined);
		await waitFor(element(matcher))
			.toBeVisible()
			.whileElement(by.id("settings-scroll"))
			.scroll(300, "down");
	}

	/**
	 * #1629 «アカウント管理»（`profile/account`）へ移動する。
	 *
	 * ⚠️ **ログアウト行とアカウント削除行はマイページ本体には無い。**
	 * `app-expo/app/[locale]/(tabs)/profile/index.tsx` に
	 * 「⚠️ ログアウトとアカウント削除をこの一覧へ戻さないこと」と明記されているとおり、
	 * «押すと戻れない» 行は閲覧系の行と分けて別ページに置く、というのがアプリ側の仕様である。
	 *
	 * ここが追随できていなかったため、`settings-scroll`（マイページ本体）を下へ送りながら
	 * `settings-logout` を探し続け、**永久に見つからず** `Got: was null` で落ちていた
	 * （2026-09-04 / 09-05 の nightly。#1579）。
	 *
	 * 既にアカウント管理ページに居るときは移動しない（spec が続けて 2 つの行を触るため）。
	 */
	async gotoAccount(): Promise<void> {
		if (await existsNow(this.accountScroll)) return;
		await this.expectRowVisible(this.accountItem);
		await tapWhenVisible(this.accountItem);
		await waitFor(element(this.accountScroll)).toExist().withTimeout(DEFAULT_TIMEOUT);
	}

	/**
	 * #1629 アカウント管理ページが出ていることを確かめる（スクロールはしない）。
	 *
	 * ⚠️ `expectLoaded()`（マイページ本体 = `settings-scroll`）と**対**である。
	 * ログアウト行・削除行を触ったあとは **アカウント管理ページに居る**ので、
	 * そこで `expectLoaded()` を呼ぶと `settings-scroll` が無く 25 秒待って落ちる
	 * （run 34019438392 で実測）。«どちらの画面に居るか» を取り違えないこと。
	 */
	async expectAccountLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.accountScroll)).toExist().withTimeout(timeout);
	}

	/**
	 * アカウント管理ページの行が **見える位置まで** スクロールする。
	 *
	 * ⚠️ `expectRowVisible()` と対になっている。あちらはマイページ本体
	 * （`settings-scroll`）、こちらはアカウント管理ページ（`account-settings-scroll`）を送る。
	 * **スクロールするコンテナが違うだけで、作法（出現待ち → 一番上へ戻す → 下へ探す）は同じ。**
	 * 片方だけ直すと、また «画面は出ているのに行が見つからない» に戻る。
	 */
	async expectAccountRowVisible(matcher: Detox.NativeMatcher, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.accountScroll)).toExist().withTimeout(timeout);
		await element(this.accountScroll)
			.scrollTo("top")
			.catch(() => undefined);
		await waitFor(element(matcher))
			.toBeVisible()
			.whileElement(this.accountScroll)
			.scroll(300, "down");
	}

	async openDeviceSettings(): Promise<void> {
		// #1583 コンテナの出現待ちを含む `expectRowVisible()` を通す
		//（素の whileElement(...).scroll() は «画面がまだ無い» と即死する）
		await this.expectRowVisible(this.deviceSettingsItem);
		await tapWhenVisible(this.deviceSettingsItem);
	}

	/**
	 * 指定した法務ドキュメントの行をタップして `/[locale]/legal/<doc>` へ遷移する（#1368）。
	 *
	 * 4 行はアプリ側で同じハンドラを通るため、`doc` の取り違え（規約を押したら著作権が開く）は
	 * **行ごとに**踏まないと見つからない。行の指定をここで引けるようにしておく。
	 */
	async openLegalDocument(doc: LegalDocumentKey): Promise<void> {
		// #1583 規約 4 行は «なに食べよについて» ページへ移った。先に移動してから押す
		await this.openAbout();
		await tapWhenVisible(this.legalItemByDoc[doc]);
	}

	/**
	 * #1583 «なに食べよについて» 行をタップしてそのページへ遷移する。
	 *
	 * `openDeviceSettings()` と同じ理由で、タップ前に «見えるまでスクロール» する
	 * （この行もマイページのかなり下にあり、エミュレータの画面高では初期表示で画面外）。
	 */
	async openAbout(): Promise<void> {
		// #1583 コンテナの出現待ちを含む `expectRowVisible()` を通す
		//（素の whileElement(...).scroll() は «画面がまだ無い» と即死する）
		await this.expectRowVisible(this.aboutItem);
		await tapWhenVisible(this.aboutItem);
		await waitUntilVisible(this.termsItem);
	}

	/**
	 * #1583 «なに食べよについて» の戻るボタンを押してマイページへ帰る。
	 *
	 * `ScreenHeader` は `${testID}-back` を出す（素の testID は出さない）。
	 * ページを分けた以上、**帰ってこられることまで見ないと行き止まりを作れる**。
	 * `DeviceSettingsScreen.goBack()` と同じ考え方。
	 */
	async goBackFromAbout(): Promise<void> {
		await tapWhenVisible(by.id("about-screen-back"));
	}

	/**
	 * #1583 «なに食べよについて» ページが出ていることを検証する。
	 *
	 * `expectLoaded()`（マイページ）と混同しないこと。規約 4 行から戻ったときの着地は
	 * マイページではなく **このページ**である。
	 */
	async expectAboutLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(by.id("about-screen-title"), timeout);
	}

	/**
	 * ログアウト行が **見える位置まで** 設定画面をスクロールする（#1131）。
	 *
	 * ## なぜ要るのか（CI で実際に赤くなった）
	 * ログアウト行はマイページ最下段のカードにあり、エミュレータの画面高では
	 * **初期表示で画面外**にいる。Detox の `toBeVisible()` は「面積の 75% 以上が可視」を
	 * 要求するので、`toExist()` は真でも `toBeVisible()` は永久に偽のまま 25 秒待って落ちる。
	 * `hasLogoutItem()` が `existsNow`（= `toExist`）なのは匿名側で「無い」ことを見るためで、
	 * **押せるかどうか**を見るこちらとは要求が違う。
	 *
	 * `whileElement(...).scroll()` は「見つかるまでスクロールする」Detox の標準手段で、
	 * 既に見えている場合は 1 度も動かさずに返る（画面が大きい端末でも安全）。
	 *
	 * ⚠️ **スクロール対象はマイページ本体ではない。** #1629 でログアウト行は
	 * `profile/account` へ移っており、`settings-scroll`（マイページ本体）をいくら下へ
	 * 送っても見つからない。`gotoAccount()` で移動してから、あちらの
	 * `account-settings-scroll` を送る。
	 */
	async scrollToLogout(): Promise<void> {
		await this.gotoAccount();
		await this.expectAccountRowVisible(this.logoutItem);
	}

	/**
	 * #1511 アカウント削除行が **見える位置まで** スクロールする。
	 *
	 * 削除行はログアウト行のさらに下にあり、エミュレータの画面高では初期表示で画面外にいる
	 * （`scrollToLogout()` と同じ事情。#1131 で CI が実際に赤くなった）。
	 */
	async scrollToDeleteAccount(): Promise<void> {
		await this.gotoAccount();
		await this.expectAccountRowVisible(this.deleteAccountItem);
	}

	/**
	 * #1511 アカウント削除行が存在するかを **待たずに** 判定する。
	 * 匿名/ログイン済みで可視性が変わるため、`hasLogoutItem()` と同じ考え方で使う。
	 */
	async hasDeleteAccountItem(): Promise<boolean> {
		return existsNow(this.deleteAccountItem);
	}

	/**
	 * #1511 アカウント削除行をタップして 1 枚目の確認ダイアログを開く（**確定しない**）。
	 *
	 * ⚠️ 確定まで行うヘルパーは **意図的に用意していない**。削除は取り消せず、
	 * dev の Supabase Auth ユーザーを消すと `tests/authenticated/` 全体が走らなくなる。
	 * 「開くところまで」しか置かないことで、誤って本物の削除を走らせる事故を構造的に防ぐ。
	 */
	async openDeleteAccountDialog(): Promise<void> {
		await this.scrollToDeleteAccount();
		await tapWhenVisible(this.deleteAccountItem);
		// Portal 経由でマウントされるため、ダイアログの描画完了（タイトル）を待つ
		await waitUntilVisible(this.deleteAccountConfirmTitle);
	}

	/**
	 * ログアウト行をタップし、確認ダイアログを「ログアウト」で確定する（#1131）。
	 *
	 * ⚠️ **セッションを破壊する操作。** 共有セッション（globalSetup 発行）で呼んではいけない
	 * （サーバ側でも失効し、後続の authenticated テストが軒並み落ちる）。
	 * 呼び出す spec の設計上の注意は tests/authenticated/logout.test.ts の冒頭コメントを参照すること。
	 */
	async logout(): Promise<void> {
		await this.scrollToLogout();
		await tapWhenVisible(this.logoutItem);
		// Portal 経由でマウントされるため、ダイアログの描画完了（タイトル）を待ってから押す
		await waitUntilVisible(this.logoutConfirmTitle);
		await tapWhenVisible(this.logoutConfirmButton);
	}
}
