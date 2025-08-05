// Data models and mock datasets for the map feature
export interface ActiveBid {
        placeId: string;
        placeName: string;
        totalAmount: number;
        remainingDays: number;
        latitude: number;
        longitude: number;
        imageUrl: string;
        rating: number;
        reviewCount: number;
}

export interface Review {
        id: string;
        dishName: string;
        imageUrl: string;
        rating: number;
        reviewCount: number;
        price: number;
}

// Mock data for active bids
export const mockActiveBids: ActiveBid[] = [
        {
                placeId: "place_1",
                placeName: "Bella Vista Restaurant",
                totalAmount: 15000,
                remainingDays: 12,
                latitude: 35.6762,
                longitude: 139.6503,
                imageUrl: "https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=400",
                rating: 4.5,
                reviewCount: 127,
        },
        {
                placeId: "place_2",
                placeName: "Tokyo Ramen House",
                totalAmount: 28000,
                remainingDays: 8,
                latitude: 35.658,
                longitude: 139.7016,
                imageUrl: "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400",
                rating: 4.2,
                reviewCount: 89,
        },
        {
                placeId: "place_3",
                placeName: "Sushi Zen",
                totalAmount: 67000,
                remainingDays: 5,
                latitude: 35.6896,
                longitude: 139.7006,
                imageUrl: "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=400",
                rating: 4.8,
                reviewCount: 203,
        },
];

// Mock reviews data
export const mockReviews: Review[] = [
        {
                id: "1",
                dishName: "Truffle Pasta",
                imageUrl: "https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=300",
                rating: 4.5,
                reviewCount: 23,
                price: 2800,
        },
        {
                id: "2",
                dishName: "Wagyu Steak",
                imageUrl: "https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=300",
                rating: 4.8,
                reviewCount: 45,
                price: 5200,
        },
];

// Mock data for bid history
export const mockBidHistory = [
        { id: "1", amount: 15000, status: "active", date: "2024-01-15", remainingDays: 12 },
        { id: "2", amount: 8000, status: "completed", date: "2024-01-10", remainingDays: 0 },
        { id: "3", amount: 12000, status: "refunded", date: "2024-01-05", remainingDays: 0 },
];
