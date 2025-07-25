export interface SearchLocation {
  latitude: number;
  longitude: number;
  address: string;
}

export interface SearchParams {
  location: SearchLocation;
  timeSlot: 'morning' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';
  scene?: 'solo' | 'date' | 'group' | 'large_group' | 'tourism';
  mood?: 'hearty' | 'light' | 'sweet' | 'spicy' | 'healthy' | 'junk' | 'alcohol';
  restrictions: string[];
  distance: number; // meters
  budgetMin: number | null; // null for no minimum
  budgetMax: number | null; // null for no maximum
}

export interface TopicCard {
  id: string;
  topicTitle: string;
  reason: string;
  googlePlaceSearchText: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  isHidden?: boolean;
}

export interface GooglePlacesPrediction {
  placeId: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}