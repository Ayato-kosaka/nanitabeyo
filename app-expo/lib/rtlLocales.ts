/**
 * 🌐 #1508 【設計】RTL（右から左）言語かどうかの判定。
 *
 * このリポジトリは RTL レイアウトに未対応（`I18nManager` / `forceRTL` / `isRTL` の
 * 使用が 0 件）。`PUBLIC_LOCALES` には `ar-SA` が含まれるが、選択すると
 * テキストは右寄せの言語なのに画面は左から右のまま描画され、レイアウトが崩れる。
 *
 * 表示言語の切り替え UI では、この一覧に当たる言語を **除外** する。除外先を
 * `ar-SA` のように決め打ちにすると、将来 `PUBLIC_LOCALES` に他の RTL 言語
 * （he-IL 等）が増えたときに個別対応を忘れて崩れた画面をそのまま出しかねないため、
 * 「RTL 言語かどうか」を言語部分（BCP 47 の先頭タグ）で判定する形にしてある。
 *
 * ⚠️ この一覧・判定はオーナー未確認の仮定（#1508 PR 参照）。RTL 対応そのものを
 * 実装する場合は、ここを消して実際のレイアウト分岐に置き換えること。
 */
const RTL_LANGUAGE_CODES = new Set([
	"ar", // アラビア語
	"he", // ヘブライ語
	"fa", // ペルシア語
	"ur", // ウルドゥー語
	"yi", // イディッシュ語
	"ps", // パシュトー語
	"sd", // シンド語
	"ku", // クルド語
	"dv", // ディベヒ語
	"ckb", // 中央クルド語（ソラニー）
	"ug", // ウイグル語
	"syr", // シリア語
]);

/** ロケール文字列（例: `ar-SA`, `ar`）が RTL 言語かどうかを、言語部分だけで判定する */
export const isRtlLocale = (locale: string): boolean => {
	const lang = locale.split("-")[0]?.toLowerCase();
	return !!lang && RTL_LANGUAGE_CODES.has(lang);
};
