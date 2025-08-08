// dateString -> timestamp(xh ago, xd ago, xweek ago, x month ago, x year ago etc.)

import i18n from "@/lib/i18n";
/**
 * Converts a date string to a human-readable timestamp format.
 * @param {string} dateString - The date string to convert.
 * @returns {string} A formatted string representing the time difference from now.
 */
export function dateStringToTimestamp(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return i18n.t('Common.timeAgo.seconds', { count: diffInSeconds });
    } else if (diffInSeconds < 3600) {
        return i18n.t('Common.timeAgo.minutes', { count: Math.floor(diffInSeconds / 60) });
    } else if (diffInSeconds < 86400) {
        return i18n.t('Common.timeAgo.hours', { count: Math.floor(diffInSeconds / 3600) });
    } else if (diffInSeconds < 2592000) {
        return i18n.t('Common.timeAgo.days', { count: Math.floor(diffInSeconds / 86400) });
    } else if (diffInSeconds < 31536000) {
        return i18n.t('Common.timeAgo.months', { count: Math.floor(diffInSeconds / 2592000) });
    } else {
        return i18n.t('Common.timeAgo.years', { count: Math.floor(diffInSeconds / 31536000) });
    }
}