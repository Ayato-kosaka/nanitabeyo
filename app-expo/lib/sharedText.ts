// lib/sharedText.ts
//
// #1400（親 #1375）OS から «共有されたテキスト» を受け取る口の型と、
// 「起動時の共有を 1 回だけ採用する」というプロセス寿命の規律。
//
// ## ここに実装は無い（PR1 はネイティブに触らない）
//
// 実際の受け取りは PR2（Android の `Intent.EXTRA_TEXT`）と PR3（iOS の Share Extension +
// App Group）が担当する。PR1 では **型と規律だけ**を確定させ、既定の実装（`lib/sharedTextSource.ts`）は
// 「何も来ない」を返す。こうしておくと PR2 / PR3 は差し替えるだけで済み、
// 分岐と罠の対処は先にユニットテストで固定できる。

/** 共有されたテキストを受け取るリスナー。解除関数を返す購読 API に渡す */
export type SharedTextListener = (text: string) => void;

/**
 * OS から共有テキストを受け取る口。
 *
 * `getInitialSharedText` と `subscribeSharedText` を分けているのは、
 * **アプリ未起動からの共有**（起動時に 1 回だけ読む）と **起動済みへの共有**（前面化のたびに来る）が
 * 別物だからである。`app/index.tsx` のディープリンクが `getInitialURL()` と
 * `addEventListener("url")` を分けているのと同じ構造にしてある。
 */
export type SharedTextSource = {
	/**
	 * 起動のきっかけになった共有テキスト。無ければ `null`。
	 *
	 * ⚠️ **この値は «今回の共有» ではなく «起動時の値» を返し続ける実装になりうる**。
	 * 呼び出しは必ず `consumeInitialSharedText()` 経由にすること（下の doc コメント参照）。
	 */
	getInitialSharedText: () => Promise<string | null>;
	/** 起動済みのアプリへ共有が来たときに呼ばれる。戻り値は購読解除関数 */
	subscribeSharedText: (listener: SharedTextListener) => () => void;
};

/**
 * #1400 起動時の共有テキストを «取り込み» として採用済みか。
 *
 * ## なぜプロセス寿命で 1 回に閉じるのか（#1124 と同じ罠）
 *
 * `Linking.getInitialURL()` は「今回のディープリンク」ではなく «起動時の URL» を返し続ける
 * （`app/index.tsx:23,72,97` / `app/[locale]/auth/callback.tsx:18,181` に既知の罠として書かれている）。
 * 共有インテントも同じ性質を持つ:
 *
 * - Android: アプリを起動した intent がそのまま `getIntent()` に残る。`onNewIntent` で
 *   差し替わるまで **同じ `EXTRA_TEXT` を返し続ける**
 * - iOS: App Group の共有ストレージに置いた値は、**消すまで残る**
 *
 * そのため「読めた値をそのまま採用する」と、画面が再マウントされるたび・アプリを開くたびに
 * **一度共有した URL が何度も取り込まれる**。防ぎ方は #1124 の対処と同じで、
 * 起動時の値を採用してよいのは **プロセスの初回 1 回だけ** とする。
 * モジュールスコープに置いているのはそのため（`app/index.tsx` の `hasConsumedInitialUrl` と同じ）。
 *
 * ⚠️ これは JS 側の防波堤であって、ネイティブ側で «消す» ことの代わりにはならない。
 * PR2 / PR3 は読み取った extra / App Group の値をネイティブ側でも必ずクリアすること。
 * 片方だけだと、アプリを完全に終了して起動し直した «次のプロセス» で同じ値をもう一度読む。
 */
let hasConsumedInitialSharedText = false;

/**
 * 起動時の共有テキストを、**プロセスにつき 1 回だけ**取り出す。
 *
 * 2 回目以降は source を呼ばずに `null` を返す。source が同じ値を返し続けても
 * 取り込みは 1 回で終わる。
 *
 * @returns 初回で共有があれば その文字列 / それ以外は `null`
 */
export const consumeInitialSharedText = async (source: SharedTextSource): Promise<string | null> => {
	// ⚠️ await の «前» に立てること。同じタスク内で 2 回呼ばれても（複数マウント・
	// StrictMode の二重実行）2 本目が source を読む前に閉じられる
	if (hasConsumedInitialSharedText) return null;
	hasConsumedInitialSharedText = true;

	try {
		return await source.getInitialSharedText();
	} catch {
		// 共有が読めないことでアプリが起動できなくなる方が害が大きい（app/index.tsx と同じ判断）
		return null;
	}
};
