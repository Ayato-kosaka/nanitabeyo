import { IsEnum, IsUUID } from "class-validator";

/**
 * Reaction エンドポイントのパスパラメータとリクエストボディ
 */
export class DishMediaReactionParamsDto {
	/** dish_media.id */
	@IsUUID()
	id!: string;
}

/**
 * Reaction の種類
 */
export enum ReactionActionType {
	LIKE = "like",
	SAVE = "save",
	OPEN_MAP = "open_map",
}

/**
 * Reaction エンドポイントのリクエストボディ
 */
export class DishMediaReactionBodyDto {
	/** アクションの種類 */
	@IsEnum(ReactionActionType)
	action_type!: ReactionActionType;
}
