import { UserProfile, UserPost } from "@/types";

export const userProfile: UserProfile = {
	id: "user_123",
	username: "foodie_explorer",
	displayName: "Food Explorer",
	avatar: "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=200&h=200",
	bio: "🍜 Food enthusiast sharing culinary adventures\n📍 Tokyo, Japan\n✨ Discovering hidden gems one bite at a time",
	totalLikes: 1250000,
	followersCount: 45600,
	followingCount: 892,
	postsCount: 127,
	isOwnProfile: true,
};

export const otherUserProfile: UserProfile = {
	id: "user_456",
	username: "chef_master",
	displayName: "Chef Master",
	avatar: "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=200&h=200",
	bio: "👨‍🍳 Professional chef & food creator\n🏆 Michelin starred restaurant owner\n📚 Sharing recipes & cooking tips",
	totalLikes: 890000,
	followersCount: 128000,
	followingCount: 234,
	postsCount: 89,
	isOwnProfile: false,
	isFollowing: false,
};

export const userPosts: UserPost[] = [
	{
		id: "1",
		imageUrl:
			"https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 15600,
		reviewCount: 234,
		views: 89000,
		dishName: "0:15",
	},
	{
		id: "2",
		imageUrl:
			"https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 23400,
		reviewCount: 456,
		views: 156000,
		dishName: "0:22",
	},
	{
		id: "3",
		imageUrl:
			"https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 18900,
		reviewCount: 312,
		views: 98000,
		dishName: "0:18",
	},
	{
		id: "4",
		imageUrl:
			"https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 12300,
		reviewCount: 189,
		views: 67000,
		dishName: "0:12",
	},
	{
		id: "5",
		imageUrl:
			"https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 19800,
		reviewCount: 278,
		views: 112000,
		dishName: "0:25",
	},
	{
		id: "6",
		imageUrl: "https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 21500,
		reviewCount: 367,
		views: 134000,
		dishName: "0:20",
	},
	{
		id: "7",
		imageUrl:
			"https://images.pexels.com/photos/6880219/pexels-photo-6880219.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 16700,
		reviewCount: 245,
		views: 89000,
		dishName: "0:16",
	},
	{
		id: "8",
		imageUrl:
			"https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 14200,
		reviewCount: 198,
		views: 76000,
		dishName: "0:14",
	},
	{
		id: "9",
		imageUrl:
			"https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 22100,
		reviewCount: 389,
		views: 145000,
		dishName: "0:28",
	},
];

export const savedPosts: UserPost[] = [
	{
		id: "s1",
		imageUrl:
			"https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 45600,
		reviewCount: 789,
		views: 234000,
		dishName: "0:30",
	},
	{
		id: "s2",
		imageUrl:
			"https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 38900,
		reviewCount: 567,
		views: 189000,
		dishName: "0:24",
	},
	{
		id: "s3",
		imageUrl: "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 52300,
		reviewCount: 892,
		views: 278000,
		dishName: "0:35",
	},
	{
		id: "s4",
		imageUrl:
			"https://images.pexels.com/photos/1633578/pexels-photo-1633578.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 41200,
		reviewCount: 634,
		views: 198000,
		dishName: "0:22",
	},
	{
		id: "s5",
		imageUrl:
			"https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 29800,
		reviewCount: 445,
		views: 156000,
		dishName: "0:18",
	},
	{
		id: "s6",
		imageUrl:
			"https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 36700,
		reviewCount: 523,
		views: 167000,
		dishName: "0:26",
	},
];

export const likedPosts: UserPost[] = [
	{
		id: "l1",
		imageUrl: "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 67800,
		reviewCount: 1234,
		views: 345000,
		dishName: "0:42",
	},
	{
		id: "l2",
		imageUrl:
			"https://images.pexels.com/photos/1633578/pexels-photo-1633578.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 54300,
		reviewCount: 987,
		views: 267000,
		dishName: "0:33",
	},
	{
		id: "l3",
		imageUrl:
			"https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 43200,
		reviewCount: 756,
		views: 198000,
		dishName: "0:28",
	},
	{
		id: "l4",
		imageUrl:
			"https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 38900,
		reviewCount: 612,
		views: 176000,
		dishName: "0:25",
	},
	{
		id: "l5",
		imageUrl:
			"https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 49600,
		reviewCount: 834,
		views: 223000,
		dishName: "0:31",
	},
	{
		id: "l6",
		imageUrl:
			"https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 56700,
		reviewCount: 1089,
		views: 289000,
		dishName: "0:38",
	},
	{
		id: "l7",
		imageUrl: "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 41800,
		reviewCount: 678,
		views: 187000,
		dishName: "0:24",
	},
	{
		id: "l8",
		imageUrl:
			"https://images.pexels.com/photos/1633578/pexels-photo-1633578.jpeg?auto=compress&cs=tinysrgb&w=400&h=711",
		likes: 35400,
		reviewCount: 567,
		views: 156000,
		dishName: "0:21",
	},
];
