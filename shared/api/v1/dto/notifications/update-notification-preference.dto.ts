import { IsBoolean, IsIn, IsString } from "class-validator";

import { NOTIFICATION_CATEGORIES } from "../../constants/notificationCategories";

/**
 * PATCH /v1/users/me/notification-preferences/{category} のパスパラメータ
 *
 * `category` は shared の対応表に載っている key のみ受け付ける。
 * DB 側に CHECK は置かない方針（カテゴリ追加に migration を要さないため）なので、
 * 未知の値が行として書き込まれないための防波堤はここになる。
 */
export class UpdateNotificationPreferenceParamsDto {
	@IsString()
	@IsIn(NOTIFICATION_CATEGORIES as unknown as string[])
	category!: string;
}

/**
 * PATCH /v1/users/me/notification-preferences/{category} のリクエストボディ
 */
export class UpdateNotificationPreferenceDto {
	/** true=プッシュを受け取る / false=プッシュを止める（アプリ内一覧には残る） */
	@IsBoolean()
	enabled!: boolean;
}
