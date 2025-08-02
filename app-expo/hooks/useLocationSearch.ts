import { useState, useCallback } from 'react';
import { GooglePlacesPrediction, SearchLocation } from '@/types/search';
import { mockGooglePlacesPredictions } from '@/data/searchMockData';

export const useLocationSearch = () => {
  const [suggestions, setSuggestions] = useState<GooglePlacesPrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchLocations = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);

    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));

      // Filter mock data based on query
      const filtered = mockGooglePlacesPredictions.filter(prediction =>
        prediction.description.toLowerCase().includes(query.toLowerCase()) ||
        prediction.structured_formatting.main_text.toLowerCase().includes(query.toLowerCase())
      );

      setSuggestions(filtered);
    } catch (error) {
      console.error('Location search error:', error);
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const getLocationDetails = useCallback(async (prediction: GooglePlacesPrediction): Promise<SearchLocation> => {
    // Mock location details - in real app, use Google Places Details API
    const mockLocations: Record<string, SearchLocation> = {
      'place_1': {
        latitude: 35.6580,
        longitude: 139.7016,
        address: '東京都渋谷区道玄坂2-1-1',
      },
      'place_2': {
        latitude: 35.6896,
        longitude: 139.7006,
        address: '東京都新宿区新宿3-38-1',
      },
      'place_3': {
        latitude: 35.6762,
        longitude: 139.7653,
        address: '東京都中央区銀座4-6-16',
      },
      'place_4': {
        latitude: 35.6702,
        longitude: 139.7026,
        address: '東京都渋谷区神宮前1-19-11',
      },
      'place_5': {
        latitude: 35.6627,
        longitude: 139.7314,
        address: '東京都港区六本木6-10-1',
      },
    };

    return mockLocations[prediction.placeId] || {
      latitude: 35.6762,
      longitude: 139.6503,
      address: prediction.description,
      placeId: prediction.placeId,
    };
  }, []);

  const getCurrentLocation = useCallback(async (): Promise<SearchLocation> => {
    // Mock current location - in real app, use expo-location
    return {
      latitude: 35.6762,
      longitude: 139.6503,
      address: '現在地（東京都渋谷区）',
    };
  }, []);

  return {
    suggestions,
    isSearching,
    searchLocations,
    getLocationDetails,
    getCurrentLocation,
  };
};