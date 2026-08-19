// api/src/v1/dish-media/dish-media.assembler.spec.ts
//
// Unit tests for DishMediaAssembler Signed Cookie generation
//

import { Test, TestingModule } from '@nestjs/testing';
import { DishMediaAssembler } from './dish-media.assembler';
import { StorageService } from '../../core/storage/storage.service';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { CookieQueueService } from '../../core/cookie-queue/cookie-queue.service';
import { AppLoggerService } from '../../core/logger/logger.service';

// Mock environment config before importing anything that depends on it
jest.mock('src/core/config/env', () => ({
  env: {
    API_COMMIT_ID: 'test',
    API_NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:3000',
    DB_SCHEMA: 'test',
    SUPABASE_JWT_SECRET: 'test-secret',
    GOOGLE_PLACE_API_KEY: 'test-key',
    GCS_BUCKET_NAME: 'test-bucket',
    GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
    GCS_STATIC_MASTER_DIR_PATH: 'static',
    CLAUDE_API_KEY: 'test-claude-key',
    GOOGLE_API_KEY: 'test-google-key',
    GOOGLE_SEARCH_ENGINE_ID: 'test-search-engine',
    GCP_PROJECT: 'test-project',
    TASKS_LOCATION: 'us-central1',
    TRANSCODER_LOCATION: 'us-central1',
    CLOUD_RUN_URL: 'http://localhost:3000',
    TASKS_INVOKER_SA: 'test@test.iam.gserviceaccount.com',
    CDN_HOST: 'test-cdn.example.com',
    CDN_KEY_NAME: 'test-key',
    CDN_KEY_SECRET_B64: Buffer.from('test-secret-key-16').toString('base64'),
    CDN_SIGNED_COOKIE_TTL_SECONDS: 600,
  },
}));

describe('DishMediaAssembler - Signed Cookie Generation', () => {
  let assembler: DishMediaAssembler;
  let mockStorage: jest.Mocked<StorageService>;
  let mockRestaurantsAssembler: jest.Mocked<RestaurantsAssembler>;
  let mockCookieQueue: jest.Mocked<CookieQueueService>;

  beforeEach(async () => {
    const mockStorageService = {
      generateCdnSignedURL: jest.fn(),
      generateCdnSignedCookies: jest.fn(),
    };

    const mockRestaurantsAssemblerService = {
      enrichRestaurantsWithImageUrls: jest.fn(),
    };

    const mockCookieQueueService = {
      enqueue: jest.fn(),
      getAll: jest.fn(),
      clear: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishMediaAssembler,
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: RestaurantsAssembler,
          useValue: mockRestaurantsAssemblerService,
        },
        {
          provide: CookieQueueService,
          useValue: mockCookieQueueService,
        },
        {
          // このテストは AppLoggerService を注入しておらず Nest の解決に失敗していた
          provide: AppLoggerService,
          useValue: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    assembler = module.get<DishMediaAssembler>(DishMediaAssembler);
    mockStorage = module.get(StorageService);
    mockRestaurantsAssembler = module.get(RestaurantsAssembler);
    mockCookieQueue = module.get(CookieQueueService);
  });

  describe('toDishMediaEntry', () => {
    it('should enqueue CDN signed cookies for video media', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'video' as const,
            // getMediaUrl() は media_processing_status が 'completed' のときだけ
            // 動画の CDN URL を作る。fixture に無く、このテストは通っていなかった
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedCookies.mockReturnValue([
        'Cloud-CDN-Cookie=test-cookie; Domain=.example.com; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None; Partitioned',
      ]);
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/thumb.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(mockStorage.generateCdnSignedCookies).toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).toHaveBeenCalled();
      expect(result.items[0].dish_media.mediaUrl).not.toContain('Expires=');
      expect(result.items[0].dish_media.mediaUrl).not.toContain('KeyName=');
      expect(result.items[0].dish_media.mediaUrl).not.toContain('Signature=');
    });

    it('should NOT enqueue CDN signed cookies for image media', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'image' as const,
            media_path: 'user-uploads/user-1/image.jpg',
            thumbnail_path: 'user-uploads/user-1/thumb.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/image.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(mockStorage.generateCdnSignedCookies).not.toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).not.toHaveBeenCalled();
      expect(result.items[0].dish_media.mediaUrl).toContain('Expires=');
      expect(result.items[0].dish_media.mediaUrl).toContain('KeyName=');
      expect(result.items[0].dish_media.mediaUrl).toContain('Signature=');
    });

    it('should deduplicate CDN signed cookies for multiple videos with same prefix', () => {
      // Arrange
      const dishMediaEntries = [
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-1',
            media_type: 'video' as const,
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video1.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb1.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 10,
          } as any,
          dish_reviews: [],
        },
        {
          restaurant: {} as any,
          dish: { reviewCount: 5, averageRating: 4.5 } as any,
          dish_media: {
            id: 'media-2',
            media_type: 'video' as const,
            media_processing_status: 'completed',
            media_path: 'user-uploads/user-1/video2.mp4',
            thumbnail_path: 'user-uploads/user-1/thumb2.jpg',
            isSaved: false,
            isLiked: false,
            likeCount: 5,
          } as any,
          dish_reviews: [],
        },
      ];

      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedCookies.mockReturnValue([
        'Cloud-CDN-Cookie=test-cookie; Domain=.example.com; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None; Partitioned',
      ]);
      mockStorage.generateCdnSignedURL.mockReturnValue(
        'https://test-cdn.example.com/test/resized/thumb.jpg?Expires=123&KeyName=test-key&Signature=abc',
      );

      // Act
      const result = assembler.toDishMediaEntry(dishMediaEntries as any);

      // Assert
      expect(result.items.length).toBe(2);
      // generateCdnSignedCookies should be called for each unique prefix
      expect(mockStorage.generateCdnSignedCookies).toHaveBeenCalled();
      expect(mockCookieQueue.enqueue).toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*        #1395 external_embed とサムネイル URL の分岐                */
  /* ------------------------------------------------------------------ */
  describe('#1395 render_type / thumbnail_external_url', () => {
    const baseEntry = (dishMedia: Record<string, unknown>) => [
      {
        restaurant: {} as any,
        dish: { reviewCount: 0, averageRating: 0 } as any,
        dish_media: {
          id: 'media-1',
          media_type: 'video' as const,
          thumbnail_path: 'user-uploads/user-1/thumb.jpg',
          thumbnail_processing_status: 'completed',
          isSaved: false,
          isLiked: false,
          likeCount: 0,
          ...dishMedia,
        } as any,
        dish_reviews: [],
      },
    ];

    beforeEach(() => {
      mockRestaurantsAssembler.enrichRestaurantsWithImageUrls.mockReturnValue(
        {} as any,
      );
      mockStorage.generateCdnSignedURL.mockImplementation(
        (url: string) => `${url}?Signature=abc`,
      );
    });

    it('external_embed は自ストレージに実体が無いので mediaUrl を作らない', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'idle',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).toBeNull();
      // 動画の Signed Cookie も発行されない（mediaUrl が null なので対象外になる）
      expect(mockStorage.generateCdnSignedCookies).not.toHaveBeenCalled();
    });

    it('stored なのに media_path が欠けていても落ちず mediaUrl は null', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: null,
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).toBeNull();
    });

    it('thumbnail_external_url があれば provider の CDN URL をそのまま返す', () => {
      const externalUrl = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg';
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'external_embed',
          media_path: null,
          media_processing_status: 'idle',
          thumbnail_processing_status: 'processing',
          thumbnail_external_url: externalUrl,
        }) as any,
      );

      // 自 CDN を経由しない = 署名もしない
      expect(result.items[0].dish_media.thumbnailImageUrl).toBe(externalUrl);
      // 戻り値は string のままなので DishMediaEntry.thumbnailImageUrl: string は破壊されない
      expect(typeof result.items[0].dish_media.thumbnailImageUrl).toBe(
        'string',
      );
    });

    it('thumbnail_external_url が無ければ従来どおり thumbnail_path から組む', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          render_type: 'stored',
          media_path: 'user-uploads/user-1/video.mp4',
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.thumbnailImageUrl).toContain(
        'test-cdn.example.com',
      );
      expect(result.items[0].dish_media.thumbnailImageUrl).toContain(
        'Signature=',
      );
    });

    it('render_type が未設定（マイグレーション適用前の行）は stored として扱う', () => {
      const result = assembler.toDishMediaEntry(
        baseEntry({
          media_path: 'user-uploads/user-1/video.mp4',
          media_processing_status: 'completed',
        }) as any,
      );

      expect(result.items[0].dish_media.mediaUrl).not.toBeNull();
    });
  });
});
