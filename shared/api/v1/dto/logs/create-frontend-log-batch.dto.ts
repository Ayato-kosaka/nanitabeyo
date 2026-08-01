import { ArrayMaxSize, ArrayMinSize, IsArray } from "class-validator";
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
	// #1079 要素の検証は api 側の FrontendLogBatchValidationPipe が 1 件ずつ行う。
	// ここで @ValidateNested({ each: true }) を使うと 1 件の不正で最大 100 件が 400 になる（#1076）。
	// @Type は残す: 要素の class 化・暗黙変換を従来どおり効かせるため。
	@Type(() => CreateFrontendLogDto)
	logs!: CreateFrontendLogDto[];
}
