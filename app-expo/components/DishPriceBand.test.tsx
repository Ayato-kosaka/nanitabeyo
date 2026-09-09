/*
#1774 料理の価格帯。**根拠が無ければ何も出さない。**

API は前からこの値を返していたが、**読む画面が 1 つも無かった**
（モックの `priceBand: null` を除くと参照 0 件）。#1375 でオーナーが踏んだ
「作成側だけあって消費側が無い」形そのもの。

空のときの見せ方は #1667 でオーナーが確定させた規則に従う。

> 未評価の場合は何も出さないのが標準かと。（2026-09-03）

⚠️ この spec の後半は **«3 件未満なら» のような条件が画面側へ漏れていないこと**を見る。
判定は `shared/utils/priceBand.ts` が唯一の置き場で、画面は値の有無しか見ない。
*/
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: {
		// 実際の locale ファイルと同じ形へ組み立てる（キーだけ返すと «並び» を検証できない）
		t: (key: string, params: Record<string, string> = {}) =>
			key === "DishPriceBand.range"
				? `${params.symbol}${params.min}〜${params.max}`
				: `${params.symbol}${params.min}〜`,
	},
}));

import { DishPriceBand } from "@/components/DishPriceBand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(element);
	});
	return tree;
};

const textOf = (tree: TestRenderer.ReactTestRenderer) => {
	const json = tree.toJSON();
	return json === null ? null : JSON.stringify(json);
};

describe("#1774 DishPriceBand", () => {
	describe("根拠が無ければ何も出さない", () => {
		it.each([
			["null", null],
			["undefined", undefined],
		])("priceBand が %s のとき、何も描かない", (_label, priceBand) => {
			expect(render(<DishPriceBand priceBand={priceBand} />).toJSON()).toBeNull();
		});

		it("⚠️ «価格不明» のようなラベルも描かない（無いものを言葉で埋めない）", () => {
			const tree = render(<DishPriceBand priceBand={null} />);
			expect(textOf(tree)).toBeNull();
		});
	});

	describe("値が来たら描く", () => {
		it("上限のある帯は «min〜max» で出す", () => {
			const tree = render(
				<DishPriceBand priceBand={{ minCents: 1000, maxCents: 1500, currencyCode: "JPY" }} testID="band" />,
			);
			expect(textOf(tree)).toContain("1,000〜1,500");
		});

		it("⚠️ 最上位の帯（上限なし）は maxCents が null。«9007199254740991» を出さない", () => {
			const tree = render(
				<DishPriceBand priceBand={{ minCents: 10000, maxCents: null, currencyCode: "JPY" }} testID="band" />,
			);
			const text = textOf(tree) ?? "";
			expect(text).toContain("10,000〜");
			expect(text).not.toMatch(/900719925474/);
		});

		it("minCents が 0 でも描く（「0円から」は正当な帯）", () => {
			const tree = render(<DishPriceBand priceBand={{ minCents: 0, maxCents: 500, currencyCode: "JPY" }} />);
			expect(tree.toJSON()).not.toBeNull();
		});

		it("JPY は小数を出さない（minor unit 0 桁）", () => {
			const tree = render(<DishPriceBand priceBand={{ minCents: 1000, maxCents: 1500, currencyCode: "JPY" }} />);
			expect(textOf(tree)).not.toContain(".");
		});
	});
});

/*
⚠️ 判定の置き場を 1 箇所に保つための検査。

「3 件未満なら出さない」「通貨が混ざったら出さない」はサーバ側
（`shared/utils/priceBand.ts`）の責務である。画面側がそれを書き足すと、
片方だけ直ってずれる。
*/
const CONSUMERS = ["features/dishMedia/components/DishMediaContent.tsx"];

describe("#1774 判定は priceBand.ts に閉じている", () => {
	it.each(CONSUMERS)("%s は値の有無しか見ない", (relative) => {
		const source = readFileSync(join(__dirname, "..", relative), "utf8");

		expect(source).toContain("DishPriceBand");
		// 件数・通貨の判定を画面側へ書き足したら赤くする
		expect(source).not.toMatch(/reviewCount\s*[<>=]/);
		expect(source).not.toMatch(/PRICE_BAND_MIN_REVIEW_COUNT/);
		expect(source).not.toMatch(/currencyCode\s*===/);
	});
});
