import { FoodItem } from "@/types";

export const foodItems: FoodItem[] = [
	{
		id: "1",
		name: "Truffle Pasta",
		image: "https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200",
		likes: 142,
		isLiked: false,
		isSaved: false,
		comments: [
			{
				id: "1",
				username: "foodie_sarah",
				text: "This looks absolutely divine! The truffle aroma must be incredible 🤤",
				timestamp: "2h ago",
			},
			{
				id: "2",
				username: "chef_mike",
				text: "Perfect pasta texture! Love the presentation",
				timestamp: "3h ago",
			},
			{
				id: "3",
				username: "italy_lover",
				text: "Authentic Italian flavors right here! When can I try this?",
				timestamp: "5h ago",
			},
		],
	},
	{
		id: "2",
		name: "Wagyu Steak",
		image: "https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200",
		likes: 298,
		isLiked: true,
		isSaved: true,
		comments: [
			{
				id: "4",
				username: "steak_master",
				text: "The marbling on this Wagyu is incredible! Perfect medium-rare 🥩",
				timestamp: "1h ago",
			},
			{
				id: "5",
				username: "fine_dining",
				text: "Worth every penny. The melt-in-your-mouth texture is unmatched",
				timestamp: "4h ago",
			},
		],
	},
	{
		id: "3",
		name: "Chocolate Soufflé",
		image: "https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200",
		likes: 186,
		isLiked: false,
		isSaved: false,
		comments: [
			{
				id: "6",
				username: "dessert_queen",
				text: "The perfect end to any meal! How do you get it so fluffy? ✨",
				timestamp: "30m ago",
			},
			{
				id: "7",
				username: "chocolate_addict",
				text: "This is pure heaven! The timing must be perfect for this soufflé",
				timestamp: "2h ago",
			},
		],
	},
];
