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