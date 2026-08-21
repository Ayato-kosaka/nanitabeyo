// lib/sharedTextSource.ts
//
// #1400（親 #1375）共有テキストの受け取り口の **既定実装**。PR1 では「何も来ない」を返す。
//
// ## ここが PR2 / PR3 との継ぎ目である
//
// PR1 の条件は「ネイティブに一切触らない」（`app.config.ts` を変えない / `plugins/` を増やさない /
// ネイティブモジュールを書かない / 依存を増やさない）。したがって OS から実際に共有を受け取る
// 手段は **まだ無い**。この既定実装はその «無い» を素直に表現したもので、
//
// - PR2（Android）… `Intent.EXTRA_TEXT` を読む実装へ差し替える
// - PR3（iOS）… Share Extension + App Group から読む実装へ差し替える
//
// のときに、**このファイルだけ**を触れば済むようにしてある。分岐と «起動時の値» の罠の対処は
// `lib/snsShareIntake.ts` / `lib/sharedText.ts` 側に閉じているので、PR2 / PR3 でやり直す必要は無い。
//
// ⚠️ プラットフォーム別実装を足すときは `sharedTextSource.android.ts` /
// `sharedTextSource.ios.ts` として置けば Metro が拡張子で解決する。このファイルは
// web と «まだ実装の無いプラットフォーム» のフォールバックとして残すこと。
//
// ## 現況（PR3 まで）
//
// - Android … `lib/sharedTextSource.android.ts` が実装済み（`ACTION_SEND` / `text/plain`）。**このファイルは使われない**
// - iOS … `lib/sharedTextSource.ios.ts` が実装済み（Share Extension + App Group `group.com.nanitabeyo`）。**このファイルは使われない**
// - web … 共有シートが無いので、このファイルのままで正しい

import type { SharedTextSource } from "./sharedText";

/**
 * 共有を受け取る手段が無い環境（web / PR2・PR3 適用前のネイティブ）の実装。
 *
 * 「起動時の共有は無い」「起動中に共有は来ない」を返すだけなので、
 * これを使っている限り取り込みの入口は完全な no-op になる。
 */
export const sharedTextSource: SharedTextSource = {
	getInitialSharedText: async () => null,
	subscribeSharedText: () => () => {},
};
