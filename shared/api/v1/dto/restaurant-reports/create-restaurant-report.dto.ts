import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import {
	RESTAURANT_REPORT_FIELDS,
	RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH,
	type RestaurantReportField,
} from "../../constants/restaurantReports";

/**
 * 🏪 `POST /v1/restaurant-reports` のリクエスト（#1933 / 決定元: #1827）。
 *
 * ## 報告者を body で受け取らない理由
 * 報告者は JWT（`@CurrentUser`）から取る。body に載せると他人になりすました報告を作れる。
 * `restaurant_reports.reporter_user_id` はサーバー側でしか埋めない
 * （`CreateContentReportDto` と同じ規則）。
 *
 * ## «値が要るか» をここで分岐させない
 * `closed`（閉店した）は事実の申告であって値を持たない。その判定は
 * `RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE` が正で、Service が 1 箇所で見る。
 * DTO 側にも同じ条件を書くと、項目を増やしたときに 2 箇所がずれる
 * （同じ判定を 2 箇所へ書いて緑のまま古い挙動を守った事故が既にある）。
 */
export class CreateRestaurantReportDto {
	/**
	 * 報告対象の店（`restaurants.id`）。
	 *
	 * ⚠️ **バージョンを固定しないこと（`@IsUUID("4")` にしない）。**
	 * 取り込み経路によって v4 以外が混ざりうる（`CreateContentReportDto` に実測の記録がある）。
	 */
	@IsUUID()
	restaurantId!: string;

	/** 何が違うのか（選択式）。集計して優先順位を付けられるようにコードで受ける */
	@IsIn(RESTAURANT_REPORT_FIELDS)
	field!: RestaurantReportField;

	/**
	 * ユーザーが入力した «正しい値»。
	 *
	 * ⚠️ 第三者の個人情報を含みうる。**外部（GitHub Issue 等）へ転記しないこと。**
	 * `POST /v1/feedback/issue` は public リポジトリの Issue へ本文をそのまま埋めているので、
	 * あれと同じ扱いをしてはいけない（migration のコメントにも同じ警告がある）。
	 */
	@IsOptional()
	@IsString()
	@MaxLength(RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH)
	proposedValue?: string;
}
