export interface NotificationItem {
	id: string;
	type: "like" | "comment" | "follow" | "mention" | "share";
	user: {
		id: string;
		username: string;
		avatar: string;
	};
	message: string;
	timestamp: string;
	postThumbnail?: string;
	isRead: boolean;
}

export interface UserProfile {
	id: string;
	username: string;
	displayName: string;
	avatar: string;
	bio: string;
	totalLikes: number;
	followersCount: number;
	followingCount: number;
	postsCount: number;
	isOwnProfile: boolean;
	isFollowing?: boolean;
}

export interface UserPost {
	id: string;
	imageUrl: string;
	likes: number;
	reviewCount: number;
	views: number;
	dishName?: string;
}

export interface SearchLocation {
	latitude: number;
	longitude: number;
	address: string;
}

export interface ApiResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	has_more: boolean;
}
