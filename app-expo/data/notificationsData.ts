import { NotificationItem } from "@/types";

export const notificationsData: NotificationItem[] = [
	{
		id: "1",
		type: "like",
		user: {
			id: "user1",
			username: "foodie_sarah",
			avatar: "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "liked your post",
		timestamp: "2h",
		postThumbnail:
			"https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: false,
	},
	{
		id: "2",
		type: "comment",
		user: {
			id: "user2",
			username: "chef_mike",
			avatar:
				"https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: 'commented: "This looks absolutely delicious! What\'s the recipe?"',
		timestamp: "3h",
		postThumbnail:
			"https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: false,
	},
	{
		id: "3",
		type: "follow",
		user: {
			id: "user3",
			username: "italy_lover",
			avatar:
				"https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "started following you",
		timestamp: "5h",
		isRead: true,
	},
	{
		id: "4",
		type: "like",
		user: {
			id: "user4",
			username: "dessert_queen",
			avatar:
				"https://images.pexels.com/photos/1130626/pexels-photo-1130626.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "liked your post",
		timestamp: "1d",
		postThumbnail:
			"https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
	{
		id: "5",
		type: "comment",
		user: {
			id: "user5",
			username: "steak_master",
			avatar:
				"https://images.pexels.com/photos/1043471/pexels-photo-1043471.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: 'commented: "Perfect medium-rare! 🥩"',
		timestamp: "1d",
		postThumbnail:
			"https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
	{
		id: "6",
		type: "mention",
		user: {
			id: "user6",
			username: "fine_dining",
			avatar:
				"https://images.pexels.com/photos/1181519/pexels-photo-1181519.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "mentioned you in a comment",
		timestamp: "2d",
		postThumbnail:
			"https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
	{
		id: "7",
		type: "share",
		user: {
			id: "user7",
			username: "chocolate_addict",
			avatar:
				"https://images.pexels.com/photos/1181686/pexels-photo-1181686.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "shared your post",
		timestamp: "3d",
		postThumbnail:
			"https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
	{
		id: "8",
		type: "like",
		user: {
			id: "user8",
			username: "pasta_lover",
			avatar:
				"https://images.pexels.com/photos/1181424/pexels-photo-1181424.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "liked your post",
		timestamp: "4d",
		postThumbnail:
			"https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
	{
		id: "9",
		type: "follow",
		user: {
			id: "user9",
			username: "sushi_chef",
			avatar:
				"https://images.pexels.com/photos/1181263/pexels-photo-1181263.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: "started following you",
		timestamp: "5d",
		isRead: true,
	},
	{
		id: "10",
		type: "comment",
		user: {
			id: "user10",
			username: "wine_expert",
			avatar:
				"https://images.pexels.com/photos/1181690/pexels-photo-1181690.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		},
		message: 'commented: "Great wine pairing suggestion!"',
		timestamp: "1w",
		postThumbnail:
			"https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		isRead: true,
	},
];
