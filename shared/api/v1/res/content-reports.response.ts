import type { ContentReportStatus } from "../constants/contentReports";

/**
 * 🚩 投稿の通報のレスポンス型（#1514 / SAF-01）。
 */

/**
 * `POST /v1/content-reports` のレスポンス。
 *
 * ## 返すのが「受付番号」だけである理由
 * オーナー確定仕様は「通報後は『受け付けました』と返すだけ。審査結果の通知は今回のスコープ外」。
 * したがって審査の進捗も、対象がどうなったか（非表示になったか等）も返さない。
 * 通報しても表示は変わらない（通報爆撃をそのまま検閲の道具にしないため）。
 */
export type CreateContentReportResponse = {
	/** 通報 ID。ユーザーへ見せる受付番号を兼ねる */
	reportId: string;
	/** 受付時点のステータス。今は必ず `pending` */
	status: ContentReportStatus;
	/**
	 * 同じ投稿を既に通報済みだったか。
	 *
	 * 重複通報は **エラーにせず、既存の通報 ID をそのまま返す**（冪等）。
	 * 409 を返すと「通報したのに失敗したように見える」うえ、
	 * «この投稿を自分が通報済みかどうか» を error で列挙できてしまう。
	 * UI はこの値によらず「受け付けました」と出す。
	 */
	alreadyReported: boolean;
};
