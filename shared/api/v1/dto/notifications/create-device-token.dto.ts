import { IsString, MaxLength, Validate, IsOptional, IsIn } from "class-validator";
import { SUPPORTED_LOCALES } from "../../../../constants/locales";

/**
 * Custom validator for Expo Push Token
 * #通知機能 【設計】Expo SDK の isExpoPushToken を利用してトークン形式を検証
 */
class IsExpoPushToken {
	validate(value: string): boolean {
		// Expo SDK の組み込みバリデータは require が必要だが、
		// class-validator の制約上、正規表現で代替
		// 公式仕様: ExpoPushToken[A-Za-z0-9_-]+
		return /^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(value);
	}

	defaultMessage(): string {
		return "expoPushToken must be a valid Expo push token format";
	}
}

/**
 * POST /v1/device-tokens リクエストボディ
 */
export class CreateDeviceTokenDto {
	/** Expo Push Token（形式: ExpoPushToken[...]) */
	@IsString()
	@Validate(IsExpoPushToken)
	@MaxLength(512)
	expoPushToken!: string;

	/** #通知機能 【設計】デバイスのロケール（Push通知の翻訳に使用） */
	@IsOptional()
	@IsString()
	@IsIn(SUPPORTED_LOCALES)
	locale?: string;
}
