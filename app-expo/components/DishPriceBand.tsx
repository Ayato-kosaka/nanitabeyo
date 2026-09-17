// app-expo/components/DishPriceBand.tsx
//
// #1774 【設計】**料理の価格帯を出す。根拠が無ければ何も出さない。**
//
// ## なぜこの component が要るのか
//
// 価格帯は API が既に `dish.priceBand` として返していたが、**それを読む画面が
// 1 つも無かった**（モックの `priceBand: null` を除くと、参照が 0 件）。
// #1375 でオーナーが踏んだ「作成側だけあって消費側が無い」形そのものである。
//
// ## 何も出さない条件
//
// `priceBand` が `null` のときは **何も描かない**。
// 「価格不明」のようなラベルも出さない。
//
// > 未評価の場合は何も出さないのが標準かと。（オーナー確定 2026-09-03 / #1667）
//
// ⚠️ `null` になる条件はサーバ側（`shared/utils/priceBand.ts`）が持っている。
// **ここで «3 件未満なら» のような条件を書き足さないこと。** 判定が 2 箇所に
// 分かれた時点で、片方だけ直ってずれる。ここが見るのは「値が来たかどうか」だけ。
//
// ## 実測（dev, 2026-09-04）
//
//     価格帯を実際に出せる料理: 3 / 2,731（0.11%）
//
// **ほとんどの行では何も出ない。** それでよい。#1666 の 3 値判定と同じ考え方で、
// 「分かっている分だけ確実に良くなる」形にしてある。データが増えれば自動的に増える。

import React, { useMemo } from "react";
import { Text, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import type { PriceBand } from "@shared/utils/priceBand";
import { getMinorUnitDigits, resolveCurrencySymbol } from "@/lib/googlePlaces";
import { useLocale } from "@/hooks/useLocale";
import i18n from "@/lib/i18n";

export type DishPriceBandProps = {
	/** API が返した価格帯。`null` なら何も描かない */
	priceBand: PriceBand | null | undefined;
	style?: StyleProp<TextStyle>;
	testID?: string;
};

/** minor unit（JPY なら 0 桁 = そのまま円）の整数を、表示用の数字へ直す */
function formatAmount(cents: number, currencyCode: string, locale: string): string {
	const digits = getMinorUnitDigits(currencyCode);
	const value = cents / 10 ** digits;
	try {
		return new Intl.NumberFormat(locale, {
			minimumFractionDigits: 0,
			maximumFractionDigits: digits,
		}).format(value);
	} catch {
		// ロケールが Intl に受け付けられない形でも、数字は出す（#1599 と同じ用心）
		return String(value);
	}
}

export function DishPriceBand({ priceBand, style, testID }: DishPriceBandProps) {
	const { locale } = useLocale();

	const label = useMemo(() => {
		if (!priceBand) return null;

		const { minCents, maxCents, currencyCode } = priceBand;
		const symbol = resolveCurrencySymbol(currencyCode, locale) ?? currencyCode;
		const min = formatAmount(minCents, currencyCode, locale);

		// 最上位の刻み（円なら 10000〜）は上限が無い。maxCents は null で来る。
		// ⚠️ ここを 0 や MAX_SAFE_INTEGER で埋めないこと（「9007199254740991円」になる）
		if (maxCents === null) {
			return i18n.t("DishPriceBand.openEnded", { symbol, min });
		}

		return i18n.t("DishPriceBand.range", {
			symbol,
			min,
			max: formatAmount(maxCents, currencyCode, locale),
		});
	}, [priceBand, locale]);

	// ⚠️ 根拠が無ければ何も描かない。「価格不明」も出さない
	if (label === null) return null;

	return (
		<Text style={[styles.text, style]} testID={testID}>
			{label}
		</Text>
	);
}

const styles = StyleSheet.create({
	text: { fontSize: 13, fontWeight: "600" },
});
