// api/src/v1/locations/locations.service.spec.ts
//
// Unit tests for LocationsService, focusing on address normalization
//

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from 'src/core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

// Mock environment variables before importing anything that uses them
process.env.API_COMMIT_ID = 'test';
process.env.API_NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DB_SCHEMA = 'dev';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
process.env.GOOGLE_PLACE_API_KEY = 'test-api-key';
process.env.GCS_BUCKET_NAME = 'test-bucket';
process.env.GCS_BUCKET_PUBLIC_NAME = 'test-bucket-public';
process.env.GCS_STATIC_MASTER_DIR_PATH = 'static/';
process.env.CLAUDE_API_KEY = 'test-claude-key';
process.env.GOOGLE_API_KEY = 'test-google-key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-search-engine';
process.env.GCP_PROJECT = 'test-project';
process.env.TASKS_LOCATION = 'us-central1';
process.env.TRANSCODER_LOCATION = 'us-central1';
process.env.TRANSCODER_PUBSUB_TOPIC = 'test-topic';
process.env.CLOUD_RUN_URL = 'http://localhost:3000';
process.env.TASKS_INVOKER_SA = 'test@test.iam.gserviceaccount.com';
process.env.PUBSUB_PUSH_SA = 'test@test.iam.gserviceaccount.com';
process.env.CDN_HOST = 'cdn.example.com';
process.env.CDN_KEY_NAME = 'test-key';
process.env.CDN_KEY_SECRET_B64 = Buffer.from('test-secret').toString('base64');
process.env.CDN_PUBLIC_HOST = 'cdn-public.example.com';

describe('LocationsService', () => {
  let service: LocationsService;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockExternalApiService: jest.Mocked<ExternalApiService>;

  beforeEach(async () => {
    mockLogger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    mockExternalApiService = {
      callPlaceDetails: jest.fn(),
      callReverseGeocoding: jest.fn(),
    } as any;

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
  });

  describe('buildNormalizedAddressComponents', () => {
    it('should normalize Japanese address components with shortText priority', () => {
      // #533 日本の住所で country が "JP" として取得できることを確認
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country', 'political'],
          },
          {
            shortText: 'Kyoto',
            longText: 'Kyoto Prefecture',
            types: ['administrative_area_level_1', 'political'],
          },
          {
            shortText: 'Kyoto',
            longText: 'Kyoto',
            types: ['locality', 'political'],
          },
          {
            shortText: '600-0000',
            longText: '600-0000',
            types: ['postal_code'],
          },
        ];

      // Private method なので any でアクセス
      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'JP', // shortText を優先
        administrative_area_level_1: 'Kyoto',
        locality: 'Kyoto',
        postal_code: '600-0000',
      });
    });

    it('should use longText when shortText is not available', () => {
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: null,
            longText: 'United States',
            types: ['country'],
          },
          {
            shortText: 'CA',
            longText: 'California',
            types: ['administrative_area_level_1'],
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'United States', // longText にフォールバック
        administrative_area_level_1: 'CA',
      });
    });

    it('should handle components with multiple types by selecting highest priority', () => {
      // #533 複数 type を持つ component の優先順位ロジック確認
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'US',
            longText: 'United States',
            types: ['country', 'political'], // country を優先
          },
          {
            shortText: 'Downtown',
            longText: 'Downtown',
            types: ['sublocality', 'sublocality_level_1', 'political'],
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'US',
        sublocality: 'Downtown', // sublocality が sublocality_level_1 より優先
      });
    });

    it('should handle address without postal_code', () => {
      // #533 postal_code がない場合のフォールバック確認
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'ES',
            longText: 'Spain',
            types: ['country'],
          },
          {
            shortText: 'CT',
            longText: 'Catalonia',
            types: ['administrative_area_level_1'],
          },
          {
            shortText: 'Barcelona',
            longText: 'Barcelona',
            types: ['locality'],
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'ES',
        administrative_area_level_1: 'CT',
        locality: 'Barcelona',
      });
    });

    it('should skip components with no types', () => {
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: 'Invalid',
            longText: 'Invalid Component',
            types: [], // types が空
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'JP',
      });
    });

    it('should skip components with no value (both shortText and longText null)', () => {
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: null,
            longText: null,
            types: ['locality'],
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'JP',
      });
    });

    it('should handle empty addressComponents array', () => {
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({});
    });

    it('should not overwrite already-set types', () => {
      // #533 同じ type が複数出現した場合、最初のものを採用
      const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
        [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: 'DUPLICATE',
            longText: 'Duplicate Country',
            types: ['country'], // すでに country が設定済み
          },
        ];

      const normalized = (service as any).buildNormalizedAddressComponents(
        addressComponents,
      );

      expect(normalized).toEqual({
        country: 'JP', // 最初の値が維持される
      });
    });
  });

  describe('getLocationDetails integration', () => {
    it('should return both address and addressComponents fields', async () => {
      // #533 新旧両方のフィールドが返されることを確認
      const mockResponse = {
        location: {
          latitude: 35.0116,
          longitude: 135.7681,
        },
        viewport: {
          low: { latitude: 34.9, longitude: 135.6 },
          high: { latitude: 35.1, longitude: 135.9 },
        },
        addressComponents: [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: 'Kyoto',
            longText: 'Kyoto Prefecture',
            types: ['administrative_area_level_1'],
          },
          {
            shortText: 'Kyoto',
            longText: 'Kyoto',
            types: ['locality'],
          },
        ],
      };

      mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

      const result = await service.getLocationDetails({
        placeId: 'test-place-id',
        languageCode: 'en',
      });

      // 表示用 address（後方互換）
      expect(result.address).toBe('Kyoto, Kyoto Prefecture, Japan');

      // type-based 正規化形式（#533）
      expect(result.addressComponents).toEqual({
        country: 'JP',
        administrative_area_level_1: 'Kyoto',
        locality: 'Kyoto',
      });
    });
  });

  describe('getReverseGeocoding integration', () => {
    it('should return both address and addressComponents fields', async () => {
      // #533 reverse geocoding でも新旧両方のフィールドが返されることを確認
      const mockResponse = {
        status: 'OK',
        results: [
          {
            geometry: {
              location: { lat: 35.0116, lng: 135.7681 },
              viewport: {
                southwest: { lat: 34.9, lng: 135.6 },
                northeast: { lat: 35.1, lng: 135.9 },
              },
            },
            address_components: [
              {
                short_name: 'JP',
                long_name: 'Japan',
                types: ['country'],
              },
              {
                short_name: 'Kyoto',
                long_name: 'Kyoto Prefecture',
                types: ['administrative_area_level_1'],
              },
            ],
          },
        ],
      };

      mockExternalApiService.callReverseGeocoding.mockResolvedValue(
        mockResponse,
      );

      const result = await service.getReverseGeocoding({
        lat: 35.0116,
        lng: 135.7681,
      });

      // 表示用 address（後方互換）
      expect(result.address).toBe('Kyoto Prefecture, Japan');

      // type-based 正規化形式（#533）
      expect(result.addressComponents).toEqual({
        country: 'JP',
        administrative_area_level_1: 'Kyoto',
      });
    });
  });
});
