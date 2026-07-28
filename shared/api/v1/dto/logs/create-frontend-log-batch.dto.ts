import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { CreateFrontendLogDto } from "./create-frontend-log.dto";

/** 1リクエストで受け付けるログの最大件数（クライアント側バッチ送信の上限20件に対し余裕を持たせる） */
export const CREATE_FRONTEND_LOG_BATCH_MAX_SIZE = 100;

/**
 * POST /v1/logs/frontend/batch のボディ
 * #1011 【設計】フロントログAPIのバッチ受け入れ対応（配列DTO）
 */
export class CreateFrontendLogBatchDto {
	/** フロントエンドログの配列（1〜100件、単発エンドポイントと同一の項目） */
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(CREATE_FRONTEND_LOG_BATCH_MAX_SIZE)
	@ValidateNested({ each: true })
	@Type(() => CreateFrontendLogDto)
	logs!: CreateFrontendLogDto[];
}
