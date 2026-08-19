// lib/legalRoute.ts
//
// #1368 【設計】法務ドキュメントのルート（app/[locale]/legal/[doc].tsx）が扱う
// «許可値» と «不正値の落とし所» を 1 箇所に集める純関数。
//
// `[doc]` は URL の動的セグメントなので、値は常に外部（共有リンク・検索結果・
// ディープリンク・手打ち）から来る。ルート側で `params.doc` を直接 `LegalDocument` へ
// 渡すと、`legalDocuments[locale][doc]` が undefined になって «空の法務ページ» が
// 200 で描画される。SEO 的にも「利用規約のはずが白紙」は最悪の壊れ方なので、
// 判定だけを router から切り離してここへ置き、ユニットテストで固定する。
//
// ⚠️ `lib/authNext.ts` と同じく router も react も import しないこと。
//    `lib/seo/sitemap.ts`（Node のスクリプトから読まれる）が LEGAL_DOCUMENT_TYPES を
//    参照するため、React Native に依存した瞬間に sitemap 生成が壊れる。

/**
 * `/[locale]/legal/[doc]` で公開する法務ドキュメントの一覧。
 *
 * 値は `features/settings/components/LegalDocument.tsx` の `DocumentType`、および
 * `features/settings/assets/legal/legalDocuments.ts` のキーと一致していなければならない
 *（一致は `__tests__/legalRoute.test.ts` で固定している）。
 *
 * この配列が sitemap（`lib/seo/sitemap.ts`）と静的生成（`[doc].tsx` の
 * `generateStaticParams`）の両方の情報源になる。**文書を増やすときはここだけを直せば
 * URL・sitemap・prerender の 3 つが同時に追従する。**
 */
export const LEGAL_DOCUMENT_TYPES = ["guidelines", "terms", "privacy", "copyright"] as const;

/** `/[locale]/legal/[doc]` の `doc` として許可する値 */
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

/**
 * sitemap に載せるパス（locale prefix より後ろ）。
 *
 * `lib/seo/sitemap.ts` の `SITEMAP_ROUTES` へ展開される。手で 4 行書くと文書を足したときに
 * 片方だけ増えるので、必ずこの導出を経由すること。
 */
export const LEGAL_SITEMAP_ROUTES: readonly string[] = LEGAL_DOCUMENT_TYPES.map((doc) => `legal/${doc}`);

/**
 * 🔒 URL から来た `doc` が公開中の法務ドキュメントかを判定する。
 *
 * @param value `useLocalSearchParams()` から受け取った生の値
 * @returns 許可値なら true
 */
export const isLegalDocumentType = (value: unknown): value is LegalDocumentType =>
	typeof value === "string" && (LEGAL_DOCUMENT_TYPES as readonly string[]).includes(value);

/**
 * 🧭 `[doc]` セグメントを表示対象へ解決する。
 *
 * ## なぜ «既定の文書へ倒さない» のか
 * 不正値のとき「とりあえず利用規約を出す」設計にすると、`/legal/foo` `/legal/bar` …
 * 無限個の URL がすべて利用規約の複製として 200 を返す。検索エンジンにとっては
 * 重複コンテンツそのもので、載せたい 4 本の評価を薄める。
 * 加えて「規約を読みに来たのに別の文書が出る」のは法務ページとして単純に誤りである。
 * よって **不正値は null（= 画面側で not-found 表示）へ倒す**。
 *
 * ## 配列を弾く理由
 * expo-router の `useLocalSearchParams()` は同名クエリが複数あると配列を返す。
 * `/legal/terms?doc=privacy` のような形で配列が来ても、意図が決まらないので採用しない。
 *
 * @param doc `useLocalSearchParams<{ doc?: string }>()` から受け取った生の値
 * @returns 公開中の文書なら型の付いた値 / それ以外は null
 */
export const resolveLegalDocument = (doc: unknown): LegalDocumentType | null => (isLegalDocumentType(doc) ? doc : null);
