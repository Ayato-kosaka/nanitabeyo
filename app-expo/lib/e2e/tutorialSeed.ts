import { Platform } from "react-native";
import { LaunchArguments } from "react-native-launch-arguments";

import { Env } from "@/constants/Env";

/**
 * 🧪 E2E(Detox) 専用: オンボーディングの「既読フラグ」を起動引数で固定する。
 *
 * ## なぜ必要か（#1027 / #1031 B4）
 * オンボーディング（#1486）は ja-JP かつ未読のとき **初回起動で自動的に開く**。
 * 検索画面の上へ push される全画面のルートで、開いている間は背後のタブバー・検索フォームへの
 * タップが届かない。つまり **オンボーディング関連以外の全 spec にとってはノイズ**でしかない。
 *
 * ⚠️ 名前に `Tutorial` が残っているのは、**ストレージキーを旧チュートリアルから変えていない**ため
 *（#1486 §3。変えると既読の既存ユーザー全員へ再表示される）。起動引数名 `e2eTutorialSeen` と
 * ビルドフラグ `EXPO_PUBLIC_E2E_TUTORIAL_HOOK` も、E2E ビルドの構成を跨いで変えると
 * CI ゲート（scripts/assert-no-e2e-hook.mjs）まで巻き込むため据え置いている。
 *
 * 当初は「出ていたら閉じる」で吸収していたが、これは本質的に競合状態を含む:
 * - 開くのは AsyncStorage の読み込み完了後で、**タブバーが見えた数百 ms 後に遅れて被さる**
 * - Android の Espresso は「別ウィンドウに覆われている」ことを可視性判定に反映しないため、
 *   案内が開いていてもタブバーは `toBeVisible()` を満たしてしまう（= 起動完了と誤判定する）
 * その結果「起動完了を待ち切ったのに直後のタップだけが落ちる」という不安定さが残り続けた
 * （run 30429560108 では 12 suite 中 10 suite がこの経路で失敗）。
 *
 * そこで **e2e-web と同じ「シードする」方式**へ揃える。
 * e2e-web は fixtures が localStorage へ視聴済みフラグを書き込み、チュートリアル spec だけが
 * `test.use({ seedTutorialSeen: false })` でそれを外している（e2e-web/fixtures/test.ts）。
 * ネイティブでは AsyncStorage を外から書けないため、**起動引数で同じ効果を出す**のがこのフック。
 *
 * ## 契約
 * - `e2eTutorialSeen: "seen"` … 既読として扱う（オンボーディングは開かない）
 * - `e2eTutorialSeen: "unseen"` … 未読として扱う（オンボーディングが開く）
 * - 未指定 … このフックは何もしない = **AsyncStorage の実データを読む**（通常ビルドと同一挙動）
 *
 * ⚠️ 値に `"1"` / `"0"` / `"true"` を使ってはいけない。react-native-launch-arguments は
 * 受け取った文字列を 1 つずつ `JSON.parse` にかけ、**成功したら型変換してしまう**
 * （`"1"` → 数値 1、`"true"` → 真偽値 true）。JSON として解釈できない語を使うことで、
 * 「文字列で渡す」という #1030 3-2 の規約が実際に守られる。
 *
 * 「完了操作が AsyncStorage へ永続化されること」を検証する spec は、
 * 1 回目を `"0"` で起動し、2 回目は **引数を渡さずに**起動する。こうすると 2 回目は実データを読むため、
 * 永続化の検証がフックによって骨抜きにならない（e2e-mobile/tests/search/onboarding.test.ts）。
 *
 * ## 本番混入防止（#1030 と同一方式）
 * 1. metro.config.js の resolveRequest が、EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1 でビルドしない限り
 *    このファイルを tutorialSeed.noop.ts へ差し替える（= 本番バンドルに 1 行も含まれない）
 * 2. 本ファイルの `process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1"` 二重ガード
 * 3. 起動引数が無ければ何もしない（通常起動と完全に同一挙動）
 * さらに CI ゲート（scripts/assert-no-e2e-hook.mjs）が sentinel の不在を検査する。
 */

// #1027 【セキュリティ】本番バンドルへの混入を CI で機械検知するための番号札（このファイル固有の文字列であること）。
// noop 実装側にはこの文字列を置かない。scripts/assert-no-e2e-hook.mjs がこの文字列を検査する。
export const E2E_TUTORIAL_SEED_SENTINEL = "__E2E_TUTORIAL_SEED_HOOK__";

/** Detox の launchArgs から受け取るテスト専用パラメータ（値は文字列のみ。#1030 3-2 と同じ規約） */
type E2ETutorialLaunchArgs = {
	/** "seen" = 既読として扱う / "unseen" = 未読として扱う / 未指定 = AsyncStorage の実データを読む */
	e2eTutorialSeen?: string;
};

/**
 * 起動引数で固定されたチュートリアル視聴済みフラグを読む。
 *
 * @returns `true`/`false` … 起動引数で固定されている / `null` … 固定されていない（実データを読むべき）
 * @失敗時 例外は投げない。ここで落とすと「オンボーディングの見え方」だけの都合でアプリが起動しなくなるため、
 *         読めなかった場合は「固定なし」として通常経路へ倒す（セッション注入フックの fail-loud とは方針が異なる。
 *         あちらは *誰でテストしているか* が嘘になるが、こちらは高々案内が 1 回余分に出るだけ）
 */
export function readE2ETutorialSeen(): boolean | null {
	// #1027 バンドルに sentinel を確実に残すための参照（DCE で消えないようにする）
	void E2E_TUTORIAL_SEED_SENTINEL;

	// web には react-native-launch-arguments のネイティブ実装が無く、E2E(Detox) の対象でもない
	if (Platform.OS === "web") return null;
	// metro resolver の差し替え（第 1 層）を何らかの理由で通過した場合の二重ガード
	if (process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK !== "1") return null;
	// EAS production 環境でビルドされた成果物では絶対に動かさない（#1030 m-3 と同じく主ガードではない）
	if (Env.NODE_ENV === "production") return null;

	let args: E2ETutorialLaunchArgs;
	try {
		args = LaunchArguments.value<E2ETutorialLaunchArgs>() ?? {};
	} catch {
		return null;
	}

	// 未指定・不正値はいずれも「固定なし」。Detox 側は "seen" / "unseen" しか渡さない
	if (args.e2eTutorialSeen !== "seen" && args.e2eTutorialSeen !== "unseen") return null;
	return args.e2eTutorialSeen === "seen";
}
