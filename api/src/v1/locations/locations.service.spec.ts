// api/src/v1/locations/locations.service.spec.ts
//
// ❶ LocationsService の単体テスト
// ❷ addressComponents バリデーションの緩和条件をテスト
// ❸ shortText または longText のいずれか存在すればOK
//

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

describe('LocationsService', () => {
  let service: LocationsService;
  let mockExternalApiService: jest.Mocked<ExternalApiService>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const mockExternalApi = {
      callPlaceDetails: jest.fn(),
      callReverseGeocoding: jest.fn(),
      callPlacesAutocomplete: jest.fn(),
      callPlaceSearchText: jest.fn(),
      getPhotoMedia: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: ExternalApiService,
          useValue: mockExternalApi,
        },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    mockExternalApiService = module.get(ExternalApiService);
    mockLogger = module.get(AppLoggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLocationDetails', () => {
    const mockQuery = {
      placeId: 'ChIJ_example_place_id',
      languageCode: 'ja',
      sessionToken: 'test-session-token',
    };

    describe('addressComponents validation', () => {
      it('should accept components with only shortText', async () => {
        // #292 【テスト】shortText のみ存在するケース
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              types: ['country'],
            },
            {
              shortText: 'Oita',
              types: ['administrative_area_level_1'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should accept components with only longText', async () => {
        // #292 【テスト】longText のみ存在するケース（Google API で実際に発生）
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              longText: 'Japan',
              types: ['country'],
            },
            {
              longText: 'Oita Prefecture',
              types: ['administrative_area_level_1'],
            },
            {
              longText: 'Oita',
              types: ['locality'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should accept components with both shortText and longText', async () => {
        // #292 【テスト】shortText と longText 両方存在するケース
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              longText: 'Japan',
              types: ['country'],
            },
            {
              shortText: 'Oita',
              longText: 'Oita Prefecture',
              types: ['administrative_area_level_1'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should reject components with neither shortText nor longText', async () => {
        // #292 【テスト】shortText も longText も存在しないケース（エラー）
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              types: ['country'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        await expect(service.getLocationDetails(mockQuery)).rejects.toThrow(
          'Invalid response from Google Places API: Missing required fields',
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          'GooglePlacesDetailsCallError',
          'getLocationDetails',
          expect.any(Object),
        );
      });

      it('should reject components without types', async () => {
        // #292 【テスト】types が存在しないケース（エラー）
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              longText: 'Japan',
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        await expect(service.getLocationDetails(mockQuery)).rejects.toThrow(
          'Invalid response from Google Places API: Missing required fields',
        );
      });
    });

    describe('resolveLocalLanguageCode with longText fallback', () => {
      it('should resolve language code using shortText when available', () => {
        // #292 【テスト】shortText がある場合は優先して使用
        const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
          [
            {
              shortText: 'JP',
              longText: 'Japan',
              types: ['country'],
            },
          ];

        const result = service.resolveLocalLanguageCode(addressComponents);

        expect(result).toBe('ja');
      });

      it('should resolve language code using longText when shortText is missing', () => {
        // #292 【テスト】shortText がない場合は longText にフォールバック
        const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
          [
            {
              longText: 'JP',
              types: ['country'],
            },
          ];

        const result = service.resolveLocalLanguageCode(addressComponents);

        // longText に ISO コードがあれば正しく解決される
        expect(result).toBe('ja');
      });
    });
  });

  describe('address building with shortText/longText fallback', () => {
    const mockQuery = {
      placeId: 'ChIJ_example_place_id',
      languageCode: 'ja',
      sessionToken: 'test-session-token',
    };

    it('should build address using shortText when available', async () => {
      // #292 【テスト】shortText 優先で住所構築（public method 経由でテスト）
      const mockResponse: protos.google.maps.places.v1.IPlace = {
        location: { latitude: 33.2382, longitude: 131.6126 },
        viewport: {
          low: { latitude: 33.2, longitude: 131.6 },
          high: { latitude: 33.3, longitude: 131.7 },
        },
        addressComponents: [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: 'Oita',
            longText: 'Oita Prefecture',
            types: ['administrative_area_level_1'],
          },
          {
            shortText: 'Oita',
            longText: 'Oita City',
            types: ['locality'],
          },
        ],
      };

      mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

      const result = await service.getLocationDetails(mockQuery);

      expect(result).toBeDefined();
      expect(result.address).toContain('country:JP');
      expect(result.address).toContain('administrative_area_level_1:Oita');
      expect(result.address).toContain('locality:Oita');
    });

    it('should build address using longText when shortText is missing', async () => {
      // #292 【テスト】shortText がない場合は longText にフォールバック（public method 経由でテスト）
      const mockResponse: protos.google.maps.places.v1.IPlace = {
        location: { latitude: 33.2382, longitude: 131.6126 },
        viewport: {
          low: { latitude: 33.2, longitude: 131.6 },
          high: { latitude: 33.3, longitude: 131.7 },
        },
        addressComponents: [
          {
            longText: 'Japan',
            types: ['country'],
          },
          {
            longText: 'Oita Prefecture',
            types: ['administrative_area_level_1'],
          },
          {
            longText: 'Oita City',
            types: ['locality'],
          },
        ],
      };

      mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

      const result = await service.getLocationDetails(mockQuery);

      expect(result).toBeDefined();
      expect(result.address).toContain('country:Japan');
      expect(result.address).toContain('administrative_area_level_1:Oita Prefecture');
      expect(result.address).toContain('locality:Oita City');
    });
  });
});
