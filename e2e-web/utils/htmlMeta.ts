/**
 * 🏷 «JS を実行していない生の HTML» から OGP / title を取り出すための小道具。
 *
 * ## なぜ専用のユーティリティが要るのか（実際に 3 往復した）
 * OGP を読むのは SNS のクローラで **JS を実行しない**ため、この種の検証は
 * `page.locator(...)` ではなく初回レスポンスの HTML 文字列を直接見る必要がある。
 * そこで安直に
 *
 *   /<meta\s+property="og:locale"\s+content="([^"]*)"/
 *
 * と書いたところ、**一度も一致しなかった**。expo export（react-helmet-async）の
 * 実際の出力は属性が 1 つ増えている:
 *
 *   <meta data-rh="true" property="og:locale" content="ja_JP"/>
 *
 * 結果として「宛先ファイルには og:locale がある（中身を読む検査は緑）」のに
 * 「レスポンスには無い（実 URL のスモークは赤）」という食い違いが起き、
 * Firebase の rewrite 設定を疑って 3 回もデプロイし直した。
 *
 * ## この実装の約束
 * - 属性の **順序と個数に依存しない**（`data-rh` のような無関係な属性を跨ぐ）
 * - `<title data-rh="true">` のように **タグに属性が付いていても読める**
 *
 * ⚠️ 呼び出し側でこの正規表現を «書き直さない» こと。同じ抽出ロジックを
 * `tests/config/firebase-rewrites.spec.ts`（dist のファイルを読む・オフライン）と
 * `tests/smoke/vote-share-ogp.spec.ts`（実ホスティングを読む）の両方で使うことで、
 * 抽出器が厳しすぎる場合に **デプロイ前のオフライン検査で落ちる**ようにしてある。
 */

/** `<meta ... property="og:xxx" ... content="...">` の content。無ければ null */
export function metaContent(html: string, property: string): string | null {
	const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// property が先か content が先かは出力側の都合で変わりうるので両方見る
	const patterns = [
		new RegExp(`<meta[^>]*\\sproperty="${escaped}"[^>]*\\scontent="([^"]*)"`, "i"),
		new RegExp(`<meta[^>]*\\scontent="([^"]*)"[^>]*\\sproperty="${escaped}"`, "i"),
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m) return m[1];
	}
	return null;
}

/** `<meta ... name="xxx" ... content="...">` の content。無ければ null */
export function metaName(html: string, name: string): string | null {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const patterns = [
		new RegExp(`<meta[^>]*\\sname="${escaped}"[^>]*\\scontent="([^"]*)"`, "i"),
		new RegExp(`<meta[^>]*\\scontent="([^"]*)"[^>]*\\sname="${escaped}"`, "i"),
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m) return m[1];
	}
	return null;
}

/**
 * `<title>` の中身。タグが無ければ null、空タグなら空文字。
 *
 * ⚠️ **`<title>` は属性付きで出力される**（`<title data-rh="true">…`）。
 * `/<title>([\s\S]*?)<\/title>/` と書くと «常に null» になり、
 * 「どのページも title が無い」という誤った結論に至る。実際そうなった。
 *
 * なお dist の中で title が空なのは **catch-all で返る root の index.html だけ**で、
 * prerender 済みのロケールページはロケール別の title を持っている。
 * つまり «title が空» は「rewrite が効かず SPA シェルに落ちた」の良い指標になる。
 */
export function titleOf(html: string): string | null {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return m ? m[1].trim() : null;
}
