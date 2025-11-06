// 純粋関数。UI/副作用/翻訳ライブラリに依存しない設計
// FW=2 の計測は Twitter 互換の簡易ヒューリスティック
export const isFullWidthChar = (ch: string): boolean => {
        const code = ch.charCodeAt(0);
        return code > 0xff;
};

export const sliceByUnitLimit = (
        text: string,
        unitLimit: number,
): {
        substring: string;
        isTruncated: boolean;
        usedUnits: number;
} => {
        let units = 0;
        let i = 0;
        while (i < text.length) {
                const add = isFullWidthChar(text[i]) ? 2 : 1;
                if (units + add > unitLimit) break;
                units += add;
                i += 1;
        }
        return {
                substring: text.slice(0, i),
                isTruncated: i < text.length,
                usedUnits: units,
        };
};

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export const formatLikeCount = (count: number, t: Translate): string => {
        if (count >= 1000000) {
                return (
                        (count / 1000000).toFixed(1).replace(/\.0$/, "") +
                        t("DishMediaContent.numberSuffix.million")
                );
        }
        if (count >= 1000) {
                return (
                        (count / 1000).toFixed(1).replace(/\.0$/, "") +
                        t("DishMediaContent.numberSuffix.thousand")
                );
        }
        return count.toString();
};
