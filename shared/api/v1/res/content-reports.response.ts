import type {
	ContentReportReasonCode,
	ContentReportStatus,
	ContentReportTargetType,
} from "../constants/contentReports";

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

/**
 * `GET /v1/users/me/content-reports` の 1 件分。
 *
 * ## 審査状況（`status`）を **返さない**
 * オーナー確定仕様（#1584）。返すのは「いつ・どの理由で出したか」だけである。
 *
 * 通報者は「誰の投稿を通報したか」を当然知っているので、審査結果まで見えると
 * **相手の投稿が消えたかどうかを推測できてしまう**。それは通報を相手への攻撃手段に変える。
 * #1514 が「相手に通知されることはありません」で守っているのと同じ配慮が、逆向きにも要る。
 *
 * したがってこの一覧の価値は «二重に通報しなくて済む» と «出したこと自体を確認できる» の 2 点に絞る。
 *
 * ⚠️ `status` / `resolution_note` / `resolved_at` を後から足さないこと。足すなら上の判断からやり直す。
 */
export type MeContentReportListItem = {
	/** 通報 ID（受付番号） */
	id: string;
	/** 通報対象の種別。投稿かレビューかだけを示す */
	targetType: ContentReportTargetType;
	/** 通報理由コード。表示名は i18n 側が持つ */
	reasonCode: ContentReportReasonCode;
	/** 受付日時（ISO 文字列） */
	createdAt: string;
};

/** `GET /v1/users/me/content-reports` のレスポンス */
export type QueryMeContentReportsResponse = {
	data: MeContentReportListItem[];
	nextCursor: string | null;
};
