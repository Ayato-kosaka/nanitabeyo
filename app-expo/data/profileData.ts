import { GetUserProfileResponse } from "@shared/api/v1/res";

// #948 【仕様】display_name/avatar_path/bio はいずれも ProfileHeader 側で isGuest 分岐して
// i18n・ローカルアセットに差し替えるため、ここでは実際には画面に出ないプレースホルダ値にする。
const getGuestProfile = (): GetUserProfileResponse => ({
	id: "guest",
	username: "guest",
	display_name: "",
	avatar_path: null,
	bio: "",
	// #948 【仕様】preferred_locale は非nullable列。ゲストの実際の表示言語は useLocale() 側で
	// 決定されこの値は参照されないため、技術的なプレースホルダとして "en" を設定する。
	preferred_locale: "en",
	created_at: new Date().toISOString(),
	last_login_at: null,
	// #1511 ACC-01 論理削除日時。ゲストは削除済みではないので null
	deleted_at: null,
	lock_no: 0,
	updated_at: new Date().toISOString(),
});

export const userProfile: GetUserProfileResponse = getGuestProfile();
