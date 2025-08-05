// Mock datasets used within the profile feature
export interface BidItem {
	id: string;
	restaurantName: string;
	bidAmount: number;
	remainingDays: number;
	status: "active" | "completed" | "refunded";
	restaurantImageUrl: string;
	imageUrl: string;
}

export interface EarningItem {
	id: string;
	dishName: string;
	earnings: number;
	status: "paid" | "pending";
	imageUrl: string;
}

// Mock data for bids
export const mockBids: BidItem[] = [
	{
		id: "1",
		restaurantName: "Bella Vista Restaurant",
		bidAmount: 15000,
		remainingDays: 12,
		status: "active",
		restaurantImageUrl:
			"https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		imageUrl: "https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
	{
		id: "2",
		restaurantName: "Tokyo Ramen House",
		bidAmount: 8000,
		remainingDays: 5,
		status: "active",
		restaurantImageUrl:
			"https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=100&h=100",
		imageUrl: "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
];

// Mock data for earnings
export const mockEarnings: EarningItem[] = [
	{
		id: "1",
		dishName: "Truffle Pasta",
		earnings: 2400,
		status: "paid",
		imageUrl: "https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
	{
		id: "2",
		dishName: "Wagyu Steak",
		earnings: 3200,
		status: "paid",
		imageUrl: "https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
	{
		id: "3",
		dishName: "Chocolate Soufflé",
		earnings: 1800,
		status: "pending",
		imageUrl: "https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
	{
		id: "4",
		dishName: "Caesar Salad",
		earnings: 1200,
		status: "paid",
		imageUrl: "https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=300",
	},
];
