import { mockDishItems } from "@/data/searchMockData";
import { QueryRestaurantsResponse } from "@shared/api/v1/res";

// Mock data for active bids
export const mockActiveBids: QueryRestaurantsResponse = mockDishItems.map((dish) => ({
	restaurant: { ...dish.restaurant, reviewCount: 120, averageRating: 4.5 },
	meta: { totalCents: 15000, maxEndDate: "2025-12-31" },
}));

// Mock data for bid history
export const mockBidHistory = [
	{ id: "1", amount: 15000, status: "active", date: "2024-01-15", remainingDays: 12 },
	{ id: "2", amount: 8000, status: "completed", date: "2024-01-10", remainingDays: 0 },
	{ id: "3", amount: 12000, status: "refunded", date: "2024-01-05", remainingDays: 0 },
];
