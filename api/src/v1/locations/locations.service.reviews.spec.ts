// api/src/v1/locations/locations.service.reviews.spec.ts
//
// Unit tests for Google Places reviews enrichment functionality
//

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { google } from '@googlemaps/places/build/protos/protos';

describe('LocationsService - Reviews Enrichment', () => {
  let service: LocationsService;
  let externalApiService: ExternalApiService;
  let logger: AppLoggerService;

  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockExternalApiService = {
    callPlaceDetails: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: AppLoggerService,
          useValue: mockLogger,
        },
        {
          provide: ExternalApiService,
          useValue: mockExternalApiService,
        },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    externalApiService = module.get<ExternalApiService>(ExternalApiService);
    logger = module.get<AppLoggerService>(AppLoggerService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('fetchReviewsFromPlaceDetails', () => {
    it('should fetch reviews successfully from Place Details API', async () => {
      const mockReviews: google.maps.places.v1.IPlace['reviews'] = [
        {
          originalText: { text: 'Great restaurant!' },
          rating: 5,
          authorAttribution: {
            displayName: 'John Doe',
            uri: 'https://maps.google.com/user1',
            photoUri: 'https://maps.google.com/photo1',
          },
        },
        {
          originalText: { text: 'Good food' },
          rating: 4,
          authorAttribution: {
            displayName: 'Jane Smith',
            uri: 'https://maps.google.com/user2',
            photoUri: 'https://maps.google.com/photo2',
          },
        },
      ];

      mockExternalApiService.callPlaceDetails.mockResolvedValue({
        reviews: mockReviews,
      });

      const result = await service.fetchReviewsFromPlaceDetails(
        'ChIJ123456',
        'ja',
      );

      expect(result).toEqual(mockReviews);
      expect(mockExternalApiService.callPlaceDetails).toHaveBeenCalledWith(
        'reviews.originalText.text,reviews.rating,reviews.authorAttribution.displayName,reviews.authorAttribution.uri,reviews.authorAttribution.photoUri',
        'ChIJ123456',
        'ja',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'PlaceDetailsFetchReviewsSuccess',
        'fetchReviewsFromPlaceDetails',
        {
          placeId: 'ChIJ123456',
          reviewCount: 2,
        },
      );
    });

    it('should return null when no reviews found in Place Details', async () => {
      mockExternalApiService.callPlaceDetails.mockResolvedValue({
        reviews: null,
      });

      const result = await service.fetchReviewsFromPlaceDetails(
        'ChIJ123456',
        'ja',
      );

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'PlaceDetailsFetchReviewsNoResults',
        'fetchReviewsFromPlaceDetails',
        {
          placeId: 'ChIJ123456',
          message: 'No reviews found in Place Details API',
        },
      );
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error');
      mockExternalApiService.callPlaceDetails.mockRejectedValue(error);

      const result = await service.fetchReviewsFromPlaceDetails(
        'ChIJ123456',
        'ja',
      );

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'PlaceDetailsFetchReviewsError',
        'fetchReviewsFromPlaceDetails',
        {
          error_message: 'API Error',
          placeId: 'ChIJ123456',
          languageCode: 'ja',
        },
      );
    });
  });

  describe('enrichTextSearchWithReviews', () => {
    it('should return unchanged response when all contexts have reviews', async () => {
      const mockResponse: google.maps.places.v1.ISearchTextResponse = {
        places: [
          {
            id: 'ChIJ123',
          },
          {
            id: 'ChIJ456',
          },
        ],
        contextualContents: [
          {
            reviews: [
              {
                originalText: { text: 'Great!' },
                rating: 5,
              },
            ],
          },
          {
            reviews: [
              {
                originalText: { text: 'Good!' },
                rating: 4,
              },
            ],
          },
        ],
      };

      const result = await service.enrichTextSearchWithReviews(
        mockResponse,
        'ja',
      );

      expect(result).toEqual(mockResponse);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EnrichTextSearchWithReviews',
        'enrichTextSearchWithReviews',
        {
          message: 'All places already have reviews',
          totalPlaces: 2,
        },
      );
      expect(mockExternalApiService.callPlaceDetails).not.toHaveBeenCalled();
    });

    it('should enrich contexts missing reviews', async () => {
      const mockResponse: google.maps.places.v1.ISearchTextResponse = {
        places: [
          {
            id: 'ChIJ123',
          },
          {
            id: 'ChIJ456',
          },
          {
            id: 'ChIJ789',
          },
        ],
        contextualContents: [
          {
            reviews: [
              {
                originalText: { text: 'Great!' },
                rating: 5,
              },
            ],
          },
          {
            reviews: [],
          },
          {},
        ],
      };

      const mockNewReviews: google.maps.places.v1.IPlace['reviews'] = [
        {
          originalText: { text: 'Excellent!' },
          rating: 5,
        },
      ];

      mockExternalApiService.callPlaceDetails.mockResolvedValue({
        reviews: mockNewReviews,
      });

      const result = await service.enrichTextSearchWithReviews(
        mockResponse,
        'ja',
      );

      expect(result.contextualContents![1].reviews).toEqual(mockNewReviews);
      expect(result.contextualContents![2].reviews).toEqual(mockNewReviews);
      expect(mockExternalApiService.callPlaceDetails).toHaveBeenCalledTimes(2);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'EnrichTextSearchWithReviews',
        'enrichTextSearchWithReviews',
        {
          totalPlaces: 3,
          placesNeedingReviews: 2,
          placeIds: ['ChIJ456', 'ChIJ789'],
        },
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'EnrichTextSearchWithReviewsComplete',
        'enrichTextSearchWithReviews',
        {
          totalPlaces: 3,
          placesEnriched: 2,
          placesFailed: 0,
        },
      );
    });

    it('should handle partial failures gracefully', async () => {
      const mockResponse: google.maps.places.v1.ISearchTextResponse = {
        places: [
          {
            id: 'ChIJ123',
          },
          {
            id: 'ChIJ456',
          },
        ],
        contextualContents: [
          {
            reviews: [],
          },
          {
            reviews: [],
          },
        ],
      };

      const mockReviews: google.maps.places.v1.IPlace['reviews'] = [
        {
          originalText: { text: 'Great!' },
          rating: 5,
        },
      ];

      mockExternalApiService.callPlaceDetails
        .mockResolvedValueOnce({ reviews: mockReviews })
        .mockResolvedValueOnce({ reviews: null });

      const result = await service.enrichTextSearchWithReviews(
        mockResponse,
        'ja',
      );

      expect(result.contextualContents![0].reviews).toEqual(mockReviews);
      expect(result.contextualContents![1].reviews).toEqual([]);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'EnrichTextSearchWithReviewsComplete',
        'enrichTextSearchWithReviews',
        {
          totalPlaces: 2,
          placesEnriched: 1,
          placesFailed: 1,
        },
      );
    });

    it('should return empty response unchanged', async () => {
      const mockResponse: google.maps.places.v1.ISearchTextResponse = {
        places: [],
      };

      const result = await service.enrichTextSearchWithReviews(
        mockResponse,
        'ja',
      );

      expect(result).toEqual(mockResponse);
      expect(mockExternalApiService.callPlaceDetails).not.toHaveBeenCalled();
    });
  });
});
