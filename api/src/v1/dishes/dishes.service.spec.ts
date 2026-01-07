// api/src/v1/dishes/dishes.service.spec.ts
//
// #636 【バグ】contextualContents.reviews フォールバックロジックのテスト
//

// Mock environment variables before any imports that use them
process.env.API_COMMIT_ID = 'test';
process.env.API_NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DB_SCHEMA = 'test';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
process.env.GOOGLE_PLACE_API_KEY = 'test-key';
process.env.GCS_BUCKET_NAME = 'test-bucket';
process.env.GCS_BUCKET_PUBLIC_NAME = 'test-bucket-public';
process.env.GCS_STATIC_MASTER_DIR_PATH = 'test-static';
process.env.CLAUDE_API_KEY = 'test-claude-key';
process.env.GOOGLE_API_KEY = 'test-google-key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-search-engine';
process.env.GCP_PROJECT = 'test-project';
process.env.TASKS_LOCATION = 'us-central1';
process.env.TRANSCODER_LOCATION = 'us-central1';
process.env.TRANSCODER_PUBSUB_TOPIC = 'test-topic';
process.env.CLOUD_RUN_URL = 'http://localhost';
process.env.TASKS_INVOKER_SA = 'test@test.iam.gserviceaccount.com';
process.env.PUBSUB_PUSH_SA = 'test@test.iam.gserviceaccount.com';
process.env.CDN_HOST = 'cdn.test.com';
process.env.CDN_KEY_NAME = 'test-key';
process.env.CDN_KEY_SECRET_B64 = 'dGVzdC1zZWNyZXQ=';
process.env.CDN_PUBLIC_HOST = 'cdn-public.test.com';

import { Test, TestingModule } from '@nestjs/testing';
import { DishesService } from './dishes.service';
import { DishesRepository } from './dishes.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../locations/locations.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('DishesService - Google Places Fallback Logic (#636)', () => {
  let service: DishesService;
  let locationsService: jest.Mocked<LocationsService>;
  let logger: jest.Mocked<AppLoggerService>;

  // Mock data helpers
  const createMockPlace = (id: string, hasReviews = false, hasPhotos = false) => ({
    id,
    displayName: { text: `Place ${id}` },
    location: { latitude: 35.6762, longitude: 139.6503 },
    addressComponents: [
      { shortText: 'JP', types: ['country'] },
    ],
    plusCode: null,
    reviews: hasReviews
      ? [
          {
            originalText: { text: 'Place review', languageCode: 'en' },
            rating: 4,
            authorAttribution: {
              displayName: 'Place Reviewer',
              photoUri: 'https://example.com/place-avatar.jpg',
            },
          },
        ]
      : undefined,
    photos: hasPhotos
      ? [
          {
            name: 'places/photo1',
            widthPx: 800,
            heightPx: 600,
          },
        ]
      : undefined,
  });

  const createMockContextualContent = (hasReviews = false, hasPhotos = false) => ({
    reviews: hasReviews
      ? [
          {
            originalText: { text: 'Contextual review', languageCode: 'en' },
            rating: 5,
            authorAttribution: {
              displayName: 'Contextual Reviewer',
              photoUri: 'https://example.com/contextual-avatar.jpg',
            },
          },
        ]
      : undefined,
    photos: hasPhotos
      ? [
          {
            name: 'contextual/photo1',
            widthPx: 1024,
            heightPx: 768,
          },
        ]
      : undefined,
  });

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const mockLocationsService = {
      searchRestaurants: jest.fn(),
      tryGetPhotoMedia: jest.fn(),
    };

    const mockRemoteConfigService = {
      getRemoteConfigValue: jest.fn().mockResolvedValue('5'),
    };

    const mockCloudTasksService = {
      enqueueCreateDishMediaEntry: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishesService,
        {
          provide: DishesRepository,
          useValue: {},
        },
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
        {
          provide: RemoteConfigService,
          useValue: mockRemoteConfigService,
        },
        {
          provide: CloudTasksService,
          useValue: mockCloudTasksService,
        },
        {
          provide: DishCategoriesRepository,
          useValue: {},
        },
        {
          provide: RestaurantsRepository,
          useValue: {},
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<DishesService>(DishesService);
    locationsService = module.get(LocationsService);
    logger = module.get(AppLoggerService);

    jest.clearAllMocks();
  });

  describe('bulkImportFromGoogle - contextualContents fallback', () => {
    const mockDto = {
      location: '35.6762,139.6503',
      radius: 5000,
      categoryName: 'エビフライ',
      categoryId: 'test-category-id',
      languageCode: 'ja',
      minRating: 3.5,
    };

    it('contextualContents.reviews が利用可能な場合はそれを使う', async () => {
      // #636 【設計】contextualContents.reviews が存在する場合、それを優先的に使用
      const mockPlace = createMockPlace('place1', true, true);
      const mockContextual = createMockContextualContent(true, true);

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace],
        contextualContents: [mockContextual],
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      await service.bulkImportFromGoogle(mockDto);

      // contextualContents の reviews が使われるべき
      expect(logger.warn).not.toHaveBeenCalledWith(
        'ContextualReviewsMissingFallbackToPlaceReviews',
        expect.anything(),
        expect.anything(),
      );
    });

    it('contextualContents.reviews が無い場合は places.reviews にフォールバック', async () => {
      // #636 【バグ】contextualContents.reviews が返らない場合の対応
      const mockPlace = createMockPlace('place1', true, true);
      const mockContextual = createMockContextualContent(false, true); // reviews なし

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace],
        contextualContents: [mockContextual],
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      await service.bulkImportFromGoogle(mockDto);

      // フォールバック発生を記録するログが呼ばれるべき
      expect(logger.warn).toHaveBeenCalledWith(
        'ContextualReviewsMissingFallbackToPlaceReviews',
        'bulkImportFromGoogle',
        expect.objectContaining({
          placeId: 'place1',
          dishCategoryName: 'エビフライ',
          contextualReviewsCount: 0,
          placeReviewsCount: 1,
        }),
      );
    });

    it('contextualContents.photos が無い場合は places.photos にフォールバック', async () => {
      // #636 【設計】photos も同様にフォールバックする
      const mockPlace = createMockPlace('place1', true, true);
      const mockContextual = createMockContextualContent(true, false); // photos なし

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace],
        contextualContents: [mockContextual],
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      await service.bulkImportFromGoogle(mockDto);

      // フォールバック発生を記録するログが呼ばれるべき
      expect(logger.warn).toHaveBeenCalledWith(
        'ContextualPhotosMissingFallbackToPlacePhotos',
        'bulkImportFromGoogle',
        expect.objectContaining({
          placeId: 'place1',
          dishCategoryName: 'エビフライ',
          contextualPhotosCount: 0,
          placePhotosCount: 1,
        }),
      );
    });

    it('contextualContents が全く無い場合でも処理を継続', async () => {
      // #636 【設計】contextualContents 自体が無い場合でも例外にしない
      const mockPlace = createMockPlace('place1', true, true);

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace],
        contextualContents: undefined, // contextualContents なし
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      await service.bulkImportFromGoogle(mockDto);

      // エラーにならず、place.reviews/photos が使われるべき
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('contextualContents.length と places.length が一致しない場合は警告ログ', async () => {
      // #636 【設計】長さ不一致の検出
      const mockPlace1 = createMockPlace('place1', true, true);
      const mockPlace2 = createMockPlace('place2', true, true);
      const mockContextual = createMockContextualContent(true, true);

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace1, mockPlace2],
        contextualContents: [mockContextual], // 長さが異なる
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      await service.bulkImportFromGoogle(mockDto);

      // 長さ不一致の警告ログが出るべき
      expect(logger.warn).toHaveBeenCalledWith(
        'ContextualContentsLengthMismatch',
        'bulkImportFromGoogle',
        expect.objectContaining({
          placesLength: 2,
          contextualContentsLength: 1,
        }),
      );
    });

    it('reviews も photos も両方無い場合でもスキップせず reviewCount=0 で処理', async () => {
      // #636 【設計】両方無い場合は空配列として扱う（reviewCount=0）
      const mockPlace = createMockPlace('place1', false, true); // reviews なし

      locationsService.searchRestaurants.mockResolvedValue({
        places: [mockPlace],
        contextualContents: [createMockContextualContent(false, true)], // reviews なし
      });

      locationsService.tryGetPhotoMedia.mockResolvedValue({
        photoUri: 'https://example.com/photo.jpg',
      } as any);

      const result = await service.bulkImportFromGoogle(mockDto);

      // reviewCount が 0 であることを確認
      expect(result[0].dish.reviewCount).toBe(0);
      expect(result[0].dish.averageRating).toBe(0);
    });

    it('places が無い場合はエラーをスロー', async () => {
      // #636 【設計】places は必須（contextualContents は任意）
      locationsService.searchRestaurants.mockResolvedValue({
        places: undefined,
        contextualContents: undefined,
      });

      await expect(service.bulkImportFromGoogle(mockDto)).rejects.toThrow(
        'No places found from Google Maps API',
      );
    });
  });
});
