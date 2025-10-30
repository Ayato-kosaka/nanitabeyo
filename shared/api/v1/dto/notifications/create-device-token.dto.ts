import { IsString, Matches, MaxLength } from "class-validator";

/**
 * POST /v1/device-tokens リクエストボディ
 */
export class CreateDeviceTokenDto {
	/** Expo Push Token（形式: ExpoPushToken[...]) */
	@IsString()
	@Matches(/^ExpoPushToken\[[A-Za-z0-9+\-=_:.]+\]$/, {
		message: "expoPushToken must be a valid Expo push token format",
	})
	@MaxLength(512)
	expoPushToken!: string;
}
