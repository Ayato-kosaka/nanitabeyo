import i18n from "@/lib/i18n";

/**
 * Profile utilities
 * プロフィール機能で使用するユーティリティ関数群
 */

/**
 * 数値をフォーマットする（K、M単位で表示）
 */
export const formatNumber = (num: number): string => {
	if (num >= 1000000) {
		return (num / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.million");
	}
	if (num >= 1000) {
		return (num / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.thousand");
	}
	return num.toString();
};
