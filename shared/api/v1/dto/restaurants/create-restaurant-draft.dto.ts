import { IsString } from "class-validator";

/**
 * POST /v1/restaurants/draft のボディ
 *
 * #1671 【設計】**店を作る前に、確認ページへ出す値を «保存せずに» 取ってくる。**
 * 返る `draftToken` を POST /v1/restaurants へ持ち回ることで、
 * サーバは Google を呼び直さずに「ユーザーが既定値を書き換えたか」を判定できる。
 */
export class CreateRestaurantDraftDto {
	/** Google Place ID */
	@IsString()
	googlePlaceId!: string;
}
