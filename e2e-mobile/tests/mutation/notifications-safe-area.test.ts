import { strict as assert } from "node:assert";

import { by, describeMutation, element, launchAppWithSession, tapWhenVisible, waitUntil } from "../../fixtures/e2e";
import { NotificationsScreen } from "../../screens/NotificationsScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 📐 お知らせ一覧の SafeArea 食い込み回帰テスト @mutation（#1130）
 *
 * ## なぜユニットテストだけでは足りないのか
 * #1130 は「お知らせ一覧のヘッダーが Android でステータスバーへ食い込む」不具合だった。
 * 原因は `react-native` の SafeAreaView（**iOS 専用実装**で Android では inset を足さない素の View）で、
 * 修正は `react-native-safe-area-context` の SafeAreaView（edges={["top"]}）への差し替え。
 *
 * app-expo/__tests__/notificationsSafeArea.test.tsx が
 * 「描画ツリーに safe-area-context の SafeAreaView が居ること」を固定しているが、
 * これは **描画ツリーの形**しか見ておらず「実際にヘッダーがステータスバーの下にあるか」は分からない。
 * 例えば別の画面が SafeAreaView を `edges={[]}` で包んでしまっても、ツリー上は同じに見える。
 * 実座標（`getAttributes()` の `frame`）を読めるのは実機/エミュレータ上の Detox だけなので、
 * ここで押さえる。
 *
 * ## 絶対値を書かず「ブロック済み料理カテゴリ一覧」と比べる理由
 * safe area inset の実値は端末のステータスバー高さ・ノッチ有無で変わり、
 * Android の `frame` は **dp ではなく物理ピクセル**（端末の density 倍）で返る。
 * つまり「上端 y が 40 以上」のような閾値はどの端末でも意味を持たない。
 *
 * Issue 本文が見本に挙げた「ブロック済み料理一覧画面と同じような上部スペース感になるべき」に従い、
 * **同じ端末上で正しく inset を避けている画面（profile/blocked-dish-categories.tsx）の上端 y と比較する**。
 * これなら端末差・単位差がそのまま相殺される。
 *
 * ## 許容差の決め方（数式で追えるようにしておく）
 * `I` を safe area の上 inset とすると、それぞれの「中身の上端」は次のようになる:
 * - ブロック済み一覧: ScreenHeader が `paddingTop: insets.top + 8` → 戻るボタンの上端 ≒ `I + 8dp`
 * - お知らせ一覧(修正後): SafeAreaView(top) の下に `paddingVertical: 16` のヘッダー → タイトル上端 ≒ `I + 16dp`
 * - お知らせ一覧(修正前): inset が足されないので `0 + 16dp`
 *
 * 差は「修正後 = +8dp 程度」「修正前 = -(I - 8dp)」。実機のステータスバーは最小でも 24dp あるので、
 * 許容差を 8〜16dp に取れば **修正後は通り、修正前は必ず落ちる**。
 * その値を端末非依存に得るため、許容差は「タイトル 1 行の高さの半分」（fontSize 20 → 実測 24dp 前後 →
 * 半分で 12dp 相当）を使う。density 倍の物理ピクセルで測っていても、比較対象と同じ倍率で
 * スケールするため成立する。
 *
 * ## Tier 3（@mutation）に置いている理由
 * 通知一覧は入場時に `markAllAsRead()` を呼び、共有 dev DB の既読状態を書き換える
 * （tests/authenticated/profile-authenticated.test.ts が「お知らせタブはタップしない」と明記しているのと同じ理由）。
 * 座標を読むだけの読み取り専用テストに見えるが、**画面を開く時点で書き込みが発生する**ためここに置く。
 * ⚠️ 既読化は元へ戻せない（不可逆）。必ずテスト専用ユーザーで実行すること。
 *
 * ## #1130 のもう一方（料理カテゴリ検索モーダルの中身が SafeArea へ食い込む）を含めない理由
 * そちらの検証にはレビュー投稿フロー（店舗選択 → レビュー作成 → モーダル起動）まで辿る必要があり、
 * 手順の長さぶんだけ本題と無関係な理由で落ちやすい。修正内容（BlurModal の中身を Card で包み、
 * 見本の LocationSearchForm と同じ 68px オフセットにする）は
 * app-expo/features/map/components/DishCategorySearchForm.test.tsx が
 * 「最外殻が Card」「オフセットが見本と一致」で固定しているため、ここでは扱わない。
 */

/** `getAttributes()` から取り出した矩形（iOS は pt / Android は物理ピクセル。同一端末内の比較にのみ使う） */
type Frame = { x: number; y: number; width: number; height: number };

/**
 * 指定インデックスの要素の矩形を読む。一致が無ければ null（例外にはしない）。
 *
 * `getAttributes()` の戻り値は「単一一致」と「複数一致（`{ elements: [...] }`）」の 2 形があり、
 * 複数一致形は iOS でしか返らない。プラットフォームで分岐しないで済むよう、
 * **常に `atIndex(i)` で 1 つずつ読む**方式に統一している。
 */
async function frameAt(matcher: Detox.NativeMatcher, index: number): Promise<Frame | null> {
	try {
		const attributes = await element(matcher).atIndex(index).getAttributes();
		const single = "elements" in attributes ? attributes.elements[0] : attributes;
		return single?.frame ?? null;
	} catch {
		// 一致が無い場合 Detox は例外を投げる。呼び出し側が「何件見つかったか」で判断できるよう null を返す
		return null;
	}
}

/** 一致したすべての要素の矩形を集める（上限 `limit` 件まで走査する） */
async function framesOf(matcher: Detox.NativeMatcher, limit = 4): Promise<Frame[]> {
	const frames: Frame[] = [];
	for (let index = 0; index < limit; index += 1) {
		const frame = await frameAt(matcher, index);
		if (frame === null) break;
		frames.push(frame);
	}
	return frames;
}

describeMutation("お知らせ一覧の SafeArea @mutation", () => {
	const tabBar = new TabBar();
	const profile = new ProfileScreen();
	const settings = new SettingsScreen();
	const notifications = new NotificationsScreen();

	/**
	 * 見本画面（ブロック済み料理カテゴリ一覧）のヘッダー戻るボタン。
	 *
	 * #1404 以前は共通の `screen-header-back` を引き、「設定とブロック済み一覧で 2 枚になること」を
	 * 遷移完了の合図にしていた。ScreenHeader の戻るが画面ごとの id（`${testID}-back`）になったので、
	 * **見本画面そのものを直接観測する**形へ変えた。合図としても «2 枚に増えるまで待つ» より正確である。
	 *
	 * #1402 の «設定をマイページ本体へ統合» とも噛み合う。統合後は遷移元が ScreenHeader を
	 * 持たないので共通 id は 1 枚しか一致せず、«2 枚» を合図にはもう使えない。
	 */
	const blockedDishCategoriesBack = by.id("blocked-dish-categories-header-back");

	beforeEach(async () => {
		// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、タップがオーバーレイに阻まれる。
		// セッション注入起動は匿名クォータを消費しないため、テストごとに起動し直して独立性を担保する
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: お知らせ一覧のヘッダーがステータスバー領域へ食い込まない ─
	// 手順:
	//   1. マイページ → ブロック済み料理カテゴリ一覧 と実導線で遷移する
	//      （ネイティブには URL 直遷移の代替経路が無いため。settings.test.ts と同方針。
	//       #1402 で歯車の 1 階層が無くなった）
	//   2. 見本画面のヘッダー（blocked-dish-categories-header-back）の上端 y を基準値として読む
	//   3. お知らせタブへ切り替え、ヘッダータイトル（notifications-header-title）の上端 y を読む
	//   4. 「お知らせの上端 y >= 見本の上端 y - 許容差」を検証する
	//      修正前は inset ぶん（最小でも 24dp）上へずれるため必ず落ちる
	it("ヘッダーの上端がブロック済み料理カテゴリ一覧と同じ高さ以下にある", async () => {
		await tabBar.gotoProfile();
		await profile.expectLoaded();
		await settings.expectLoaded();
		// SettingsScreen に遷移ヘルパを足さず、ここで行を直接タップしている。
		// この spec が必要とするのは「見本画面のヘッダー座標」だけで、
		// ブロック済み一覧そのものの検証（文言など）は別 spec の担当だから
		await tapWhenVisible(settings.blockedDishCategoriesItem);

		// ブロック済み一覧は 0 件時に空表示、1 件以上でリストと描画が分かれるため、ロケール非依存で
		// 待てる観測点はヘッダーしかない。#1404 でヘッダーの戻るが画面ごとの id になったので、
		// «見本画面のヘッダーが出ること» をそのまま待てる（以前は共通 id が 2 枚になるのを待っていた）
		await waitUntil(async () => (await framesOf(blockedDishCategoriesBack)).length >= 1, {
			description: "ブロック済み料理カテゴリ一覧への遷移（そのヘッダーが描かれること）",
		});

		const baselineFrames = await framesOf(blockedDishCategoriesBack);
		// 通常は 1 枚だが、万一複数取れた場合は **下側（y が大きい方）** を採る。基準値が小さいほど
		// アサーションは甘くなるため、「読み違いで緑になる」より「厳しく見て落ちる」side へ倒しておく
		const baselineTop = Math.max(...baselineFrames.map((frame) => frame.y));
		assert.ok(
			baselineTop > 0,
			`見本画面（ブロック済み料理カテゴリ一覧）のヘッダー上端が ${baselineTop} で、基準値として使えません`,
		);

		await tabBar.gotoNotifications();
		await notifications.expectLoaded();

		const headerFrames = await framesOf(notifications.headerTitle);
		assert.equal(
			headerFrames.length,
			1,
			`notifications-header-title は 1 件だけ一致するはずが ${headerFrames.length} 件でした`,
		);
		const headerFrame = headerFrames[0];

		// 許容差 = タイトル 1 行の高さの半分（≒ 12dp 相当）。
		// 意図した差（+8dp）より大きく、最小のステータスバー高さ（24dp）より小さいので、
		// 「正しいレイアウトは通す」「inset を足し忘れた状態は落とす」を両立できる（冒頭の解説参照）
		const tolerance = headerFrame.height / 2;
		assert.ok(
			headerFrame.y >= baselineTop - tolerance,
			[
				"お知らせ一覧のヘッダーがステータスバー領域へ食い込んでいます（#1130 の再発）。",
				`  お知らせ一覧のヘッダー上端: ${headerFrame.y}`,
				`  ブロック済み料理カテゴリ一覧のヘッダー上端: ${baselineTop}（許容差 ${tolerance}）`,
				"  react-native の SafeAreaView（iOS 専用実装）へ戻していないか確認してください。",
			].join("\n"),
		);
	});
});
