import { IsIn, IsUUID } from "class-validator";

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
const ReactionActionTypes = ["like", "save", "open_map"] as const;
export type ReactionActionType = (typeof ReactionActionTypes)[number];

/**
 * Reaction エンドポイントのリクエストボディ
 */
export class DishMediaReactionBodyDto {
	/** アクションの種類 */
	@IsIn(ReactionActionTypes)
	action_type!: ReactionActionType;
}
