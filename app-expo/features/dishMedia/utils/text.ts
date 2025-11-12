// 純粋関数。UI/副作用/翻訳ライブラリに依存しない設計
import i18n from "@/lib/i18n";

// 全角文字かどうかを判定する簡易関数
const isFullWidthChar = (ch: string) => {
	const code = ch.charCodeAt(0);
	return code > 0xff; // simple heuristic
};

// 文字列を指定されたユニット数で切り取る
export const sliceByUnitLimit = (text: string, unitLimit: number) => {
	let units = 0;
	let i = 0;
	while (i < text.length) {
		const add = isFullWidthChar(text[i]) ? 2 : 1;
		if (units + add > unitLimit) break;
		units += add;
		i++;
	}
	return {
		substring: text.slice(0, i),
		isTruncated: i < text.length,
		usedUnits: units,
	};
};

// いいね数をフォーマットする
export const formatLikeCount = (count: number): string => {
	if (count >= 1000000) {
		return (count / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("DishMediaContent.numberSuffix.million");
	}
	if (count >= 1000) {
		return (count / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("DishMediaContent.numberSuffix.thousand");
	}
	return count.toString();
};
