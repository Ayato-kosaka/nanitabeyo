export interface Comment {
  id: string;
  username: string;
  text: string;
  timestamp: string;
  avatar?: string;
}

export interface FoodItem {
  id: string;
  name: string;
  image: string;
  description: string;
  likes: number;
  isLiked: boolean;
  isSaved: boolean;
  comments: Comment[];
}

export interface NotificationItem {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'mention' | 'share';
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
  image: string;
  likes: number;
  comments: number;
  views: number;
  duration?: string;
}

// Developer Debug Screen Types
export interface DishMedia {
  id: string;
  dish_name: string;
  image_url: string;
  price: number;
  review_count: number;
  average_rating: number;
  restaurant_name: string;
  restaurant_id: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  };
  reviews: Review[];
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  user_name: string;
  user_avatar?: string;
  rating: number;
  comment: string;
  created_at: string;
  helpful_count: number;
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

export interface GooglePlacesPrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}