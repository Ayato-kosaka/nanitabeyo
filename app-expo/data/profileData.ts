import { GetUserProfileResponse } from "@shared/api/v1/res";
import { SupabaseUsers } from "@shared/converters/convert_users";

const getGuestProfile = (): GetUserProfileResponse => ({
	id: "guest",
	username: "guest",
	display_name: "Guest",
	avatar_path: "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=200&h=200", // Fixed logo will be updated later
	bio: "",
	preferred_locale: "ar",
	created_at: new Date().toISOString(),
	last_login_at: null,
	lock_no: 0,
	updated_at: new Date().toISOString(),
});

export const userProfile: GetUserProfileResponse = getGuestProfile();

export const otherUserProfile: SupabaseUsers = {
	id: "user_456",
	username: "chef_master",
	display_name: "Chef Master",
	avatar_path: "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=200&h=200",
	bio: "👨‍🍳 Professional chef & food creator\n🏆 Michelin starred restaurant owner\n📚 Sharing recipes & cooking tips",
	preferred_locale: "ar",
	created_at: new Date().toISOString(),
	last_login_at: null,
	lock_no: 0,
	updated_at: new Date().toISOString(),
};
