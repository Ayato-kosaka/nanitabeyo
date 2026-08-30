/*
#1368 【設計】`/[locale]/legal/[doc]` の «許可値» と «不正値の落とし所» を固定する。

## なぜ必要か
`doc` は URL の動的セグメントなので、値は常に外部（共有リンク・検索結果・ディープリンク・手打ち）
から来る。検証を外すと `legalDocuments[locale][doc]` が undefined になり、
**「利用規約」のはずのページが 200 で白紙になる**。しかもこのルートは sitemap に載っているので、
壊れた URL がそのままクローラへ提出される。

## 何を守るか
1. 許可値がドキュメント本体（assets）と 1 対 1 で対応していること
   → 文書を足したのに `LEGAL_DOCUMENT_TYPES` を直し忘れると赤くする
2. 不正値が «既定の文書» へ倒れないこと（無限個の重複ページを作らないため）
3. sitemap のパスが許可値から導出されていること（片方だけ増えるのを防ぐ）
*/
import { legalDocuments } from "@/features/settings/assets/legal/legalDocuments";
import {
	isLegalDocumentType,
	LEGAL_DOCUMENT_TYPES,
	LEGAL_SITEMAP_ROUTES,
	resolveLegalDocument,
} from "@/lib/legalRoute";

describe("#1368 LEGAL_DOCUMENT_TYPES", () => {
	it("公開中の 4 文書を持つ", () => {
		expect([...LEGAL_DOCUMENT_TYPES]).toEqual(["guidelines", "terms", "privacy", "copyright"]);
	});

	// 許可値とアセットがずれると「URL は開けるが中身が空」という一番気付きにくい壊れ方になる。
	// 実体は ja-JP / en-US の 2 ロケール分（LegalDocument は他ロケールを en-US へフォールバックする）
	it.each(["ja-JP", "en-US"] as const)("%s の全文書に本文がある", (locale) => {
		for (const doc of LEGAL_DOCUMENT_TYPES) {
			expect(typeof legalDocuments[locale][doc]).toBe("string");
			expect(legalDocuments[locale][doc].length).toBeGreaterThan(0);
		}
	});

	it("アセット側に、許可値へ含め忘れた文書が無い", () => {
		expect(Object.keys(legalDocuments["ja-JP"]).sort()).toEqual([...LEGAL_DOCUMENT_TYPES].sort());
	});
});

describe("#1368 resolveLegalDocument", () => {
	it.each(LEGAL_DOCUMENT_TYPES)("公開中の文書 %s はそのまま通す", (doc) => {
		expect(resolveLegalDocument(doc)).toBe(doc);
	});

	// ⚠️ ここが「既定の文書へ倒す」実装に変わると、`/legal/<任意の文字列>` が全部
	// 同じ文書の複製として 200 を返す（重複コンテンツ）。null 以外を返させないこと
	it.each([
		["未知の文書", "tos"],
		["空文字", ""],
		["大文字違い（URL は大小を区別する）", "Terms"],
		["前後の空白付き", " terms "],
		["パス区切りを含む", "terms/../privacy"],
		["配列（同名クエリが複数あるとき expo-router が返す形）", ["terms", "privacy"]],
		["未指定", undefined],
		["null", null],
	])("%s は null へ倒す", (_label, value) => {
		expect(resolveLegalDocument(value)).toBeNull();
		expect(isLegalDocumentType(value)).toBe(false);
	});
});

describe("#1368 LEGAL_SITEMAP_ROUTES", () => {
	it("許可値から導出され、locale prefix より後ろのパスになっている", () => {
		expect([...LEGAL_SITEMAP_ROUTES]).toEqual(LEGAL_DOCUMENT_TYPES.map((doc) => `legal/${doc}`));
	});
});
