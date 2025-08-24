import { IsIn, IsString, Length } from "@nestjs/class-validator";

/** POST /v1/feedback/issue のボディ */
export class CreateFeedbackDto {
	/** フィードバックの種類 */
	@IsIn(['request', 'bug'])
	type!: 'request' | 'bug';

	/** タイトル (5-80文字) */
	@IsString()
	@Length(5, 80)
	title!: string;

	/** メッセージ (10-2000文字) */
	@IsString()
	@Length(10, 2000)
	message!: string;

	/** OS情報 */
	@IsString()
	os!: string;

	/** デバイス情報 */
	@IsString()
	device!: string;
}
