import { mockDishItems } from "@/data/searchMockData";
import type { QueryRestaurantBidsResponse, QueryRestaurantsResponse } from "@shared/api/v1/res";
import type { Region } from "react-native-maps";

export const mapReviewsKey = (id: string) => `mapReviews-${id}`;

export const INITIAL_REGION: Region = {
	latitude: 35.6762,
	longitude: 139.6503,
	latitudeDelta: 0.01,
	longitudeDelta: 0.01,
};

export const REGION_JP: Region = {
	// 日本のだいたいの中心
	latitude: 36.2048,
	longitude: 138.2529,
	// 日本全体が入るくらいのデルタ（お好みで調整）
	latitudeDelta: 20,
	longitudeDelta: 20,
};

// Mock data for active bids
export const mockActiveBids: QueryRestaurantsResponse = mockDishItems.map((dish) => ({
	restaurant: { ...dish.restaurant },
	meta: {
		reviewCount: 120,
		averageRating: 4.5,
		totalCents: 15000,
		maxEndDate: "2025-12-31",
	},
}));

// Mock data for bid history
export const mockBidHistory: QueryRestaurantBidsResponse = [
	{
		id: "1",
		amount_cents: 15000,
		status: "pending",
		end_date: "2026-01-15",
		created_at: "2023-12-01",
		currency_code: "USD",
		lock_no: 101,
		payment_intent_id: null,
		refund_id: null,
		restaurant_id: "rest_1",
		start_date: "2023-12-01",
		updated_at: "2023-12-02",
		user_id: "user_1",
	},
	{
		id: "2",
		amount_cents: 8000,
		status: "paid",
		end_date: "2024-01-10",
		created_at: "2023-11-01",
		currency_code: "USD",
		lock_no: 102,
		payment_intent_id: "pi_123",
		refund_id: null,
		restaurant_id: "rest_2",
		start_date: "2023-11-01",
		updated_at: "2023-11-02",
		user_id: "user_2",
	},
	{
		id: "3",
		amount_cents: 12000,
		status: "refunded",
		end_date: "2024-01-05",
		created_at: "2023-10-01",
		currency_code: "USD",
		lock_no: 103,
		payment_intent_id: null,
		refund_id: "rf_456",
		restaurant_id: "rest_3",
		start_date: "2023-10-01",
		updated_at: "2023-10-02",
		user_id: "user_3",
	},
];
