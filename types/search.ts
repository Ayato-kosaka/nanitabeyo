export interface SearchLocation {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface SearchParams {
  location: SearchLocation;
  timeSlot: 'morning' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';
  scene?: 'solo' | 'date' | 'group' | 'large_group' | 'tourism';
  mood?: 'hearty' | 'light' | 'sweet' | 'spicy' | 'healthy' | 'junk' | 'alcohol';
  restrictions: string[];
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

export interface CardHideReason {
  cardId: string;
  reason: string;
  timestamp: string;
}

export interface GooglePlacesPrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}