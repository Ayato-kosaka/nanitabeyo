import type { RestaurantReportStatus } from "../constants/restaurantReports";

/**
 * 🏪 店舗情報の «この情報が違う» 報告のレスポンス型（#1933 / 決定元: #1827）。
 */

/**
 * `POST /v1/restaurant-reports` のレスポンス。
 *
 * ## 返すのが «受付番号» だけである理由
 * 受け入れ条件 5 は「画面上は『受け付けました』だけ。店の情報はその場では変わらない」。
 * したがって反映の見込みも、店がどうなったかも返さない。誤報・荒らしがそのまま本番へ
 * 乗らないための規則で、OSM / Google / 食べログの 3 例に共通していた
 * （#1827 の調査）。
 */
export type CreateRestaurantReportResponse = {
	/** 報告 ID。ユーザーへ見せる受付番号を兼ねる */
	reportId: string;
	/** 受付時点のステータス。今は必ず `pending` */
	status: RestaurantReportStatus;
	/**
	 * 同じ店の同じ項目を既に報告済みだったか（受け入れ条件 10）。
	 *
	 * 二重報告は **エラーにせず既存の報告 ID を返す**（冪等）。409 を返すと
	 * 「送ったのに失敗した」に見えるうえ、**却下済みかどうかを error で観測できてしまう**。
	 * UI はこの値によらず「受け付けました」と出す（`content_reports` と同じ作法）。
	 */
	alreadyReported: boolean;
};
