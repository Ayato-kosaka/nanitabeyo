import { IsString, IsObject, IsOptional, MinLength } from "class-validator";

/**
 * POST /v1/contribution-tasks のリクエストDTO
 *
 * ユーザー協力タスクの結果を記録する際に使用
 */
export class CreateContributionTaskDto {
	/**
	 * 協力の種類
	 * 例: image_feedback, image_comparison, text_feedback, choice_vote
	 */
	@IsString()
	@MinLength(1)
	type!: string;

	/**
	 * 企画を識別するキー
	 * 例: food_image_optimize_v1, restaurant_card_ab_2026_01
	 */
	@IsString()
	@MinLength(1)
	taskKey!: string;

	/**
	 * 協力対象の種別
	 * 例: dish_categories, image, app_screen
	 */
	@IsString()
	@MinLength(1)
	targetType!: string;

	/**
	 * 協力対象のID
	 */
	@IsString()
	targetId!: string;

	/**
	 * ユーザーに提示した情報
	 * 後から当時の状況を再現できるよう、表示内容や質問文などを保存
	 */
	@IsOptional()
	@IsObject()
	payload?: Record<string, unknown>;

	/**
	 * ユーザーの回答・選択結果
	 * 選択肢、評価スコア、自由記述コメントなどを保存
	 */
	@IsOptional()
	@IsObject()
	result?: Record<string, unknown>;
}
