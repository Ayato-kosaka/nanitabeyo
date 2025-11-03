/**
 * 📅 日時フォーマットユーティリティ
 */

/**
 * 相対時間を取得（例: "2h", "3d"）
 *
 * @param date - 対象の日時
 * @returns 相対時間文字列
 */
export const formatTimeAgo = (date: Date | string): string => {
	const targetDate = typeof date === "string" ? new Date(date) : date;
	const now = new Date();
	const diffMs = now.getTime() - targetDate.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 60) {
		return `${diffMins}m`;
	} else if (diffHours < 24) {
		return `${diffHours}h`;
	} else {
		return `${diffDays}d`;
	}
};
