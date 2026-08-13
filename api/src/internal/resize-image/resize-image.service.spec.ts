// api/src/internal/resize-image/resize-image.service.spec.ts
//
// Unit tests for ResizeImageService JPEG decode error handling
//

import { Test, TestingModule } from '@nestjs/testing';
import {
  ResizeImageService,
  PermanentImageError,
} from './resize-image.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import * as sharp from 'sharp';
import { Jimp, JimpMime } from 'jimp';

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
    CDN_KEY_SECRET_B64: Buffer.from('test-secret').toString('base64'),
  },
}));

// Mock modules
jest.mock('sharp');
jest.mock('jimp', () => ({
  Jimp: {
    read: jest.fn(),
  },
  JimpMime: {
    jpeg: 'image/jpeg',
  },
}));

describe('ResizeImageService - JPEG Decode Error Handling', () => {
  let service: ResizeImageService;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockStorage: jest.Mocked<StorageService>;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const mockStorageService = {
      fileExists: jest.fn(),
      generateSignedUrl: jest.fn(),
      uploadFileAtPath: jest.fn(),
    };

    const mockPrismaService = {
      withTransaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResizeImageService,
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ResizeImageService>(ResizeImageService);
    mockLogger = module.get(AppLoggerService);
    mockStorage = module.get(StorageService);
    mockPrisma = module.get(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();

    // Mock fetch globally
    global.fetch = jest.fn();
  });

  describe('JPEG decode error recovery with Jimp', () => {
    const testDto = {
      table: 'dish_media',
      column: 'original_image_path',
      recordId: '12345678-1234-1234-1234-123456789012',
      size: 512 as 64 | 256 | 512 | 1024,
      originalPath: 'test/path/image.jpg',
    };

    beforeEach(() => {
      // Mock file does not exist (new resize operation)
      mockStorage.fileExists.mockResolvedValue(false);

      // Mock successful download
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(100)),
      } as any);

      mockStorage.generateSignedUrl.mockResolvedValue(
        'https://example.com/signed',
      );
    });

    it('should successfully resize without Jimp when Sharp works normally', async () => {
      // Mock successful Sharp processing
      const mockSharp = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-data')),
      };
      (sharp as unknown as jest.Mock).mockReturnValue(mockSharp);

      mockStorage.uploadFileAtPath.mockResolvedValue({
        path: 'test/resized/path.webp',
        signedUrl: 'https://example.com/resized',
      });

      const result = await service.resizeAndStoreImage(testDto);

      expect(result).toEqual({
        path: 'test/resized/path.webp',
        signedUrl: 'https://example.com/resized',
        alreadyExisted: false,
      });

      // Jimp should not be called
      expect(Jimp.read).not.toHaveBeenCalled();

      // Should call rotate to normalize EXIF Orientation
      expect(mockSharp.rotate).toHaveBeenCalledWith();

      // Should log completion
      expect(mockLogger.log).toHaveBeenCalledWith(
        'ResizeImageCompleted',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should recover from "Invalid SOS parameters for sequential JPEG" error using Jimp', async () => {
      let sharpCallCount = 0;
      const jpegError = new Error(
        'VipsJpeg: Invalid SOS parameters for sequential JPEG',
      );

      // First Sharp call fails with JPEG error, second succeeds
      (sharp as unknown as jest.Mock).mockImplementation(() => {
        sharpCallCount++;
        if (sharpCallCount === 1) {
          return {
            rotate: jest.fn().mockReturnThis(),
            resize: jest.fn().mockReturnThis(),
            webp: jest.fn().mockReturnThis(),
            toBuffer: jest.fn().mockRejectedValue(jpegError),
          };
        } else {
          return {
            rotate: jest.fn().mockReturnThis(),
            resize: jest.fn().mockReturnThis(),
            webp: jest.fn().mockReturnThis(),
            toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-data')),
          };
        }
      });

      // Mock Jimp re-encoding
      const mockJimpImage = {
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('reencoded-jpeg')),
      };
      (Jimp.read as jest.Mock).mockResolvedValue(mockJimpImage);

      mockStorage.uploadFileAtPath.mockResolvedValue({
        path: 'test/resized/path.webp',
        signedUrl: 'https://example.com/resized',
      });

      const result = await service.resizeAndStoreImage(testDto);

      expect(result).toEqual({
        path: 'test/resized/path.webp',
        signedUrl: 'https://example.com/resized',
        alreadyExisted: false,
      });

      // Should log decode error
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ResizeImageDecodeError',
        'resizeImage',
        expect.objectContaining({
          attemptingReencode: true,
        }),
      );

      // Should log re-encoding success
      expect(mockLogger.log).toHaveBeenCalledWith(
        'ImageReencoded',
        'resizeImage',
        expect.any(Object),
      );

      // Should log completion after re-encode
      expect(mockLogger.log).toHaveBeenCalledWith(
        'ResizeImageCompletedAfterReencode',
        'resizeImage',
        expect.any(Object),
      );

      // Jimp should be called
      expect(Jimp.read).toHaveBeenCalledWith(expect.any(Buffer));
      expect(mockJimpImage.getBuffer).toHaveBeenCalledWith(JimpMime.jpeg, {
        quality: 95,
      });

      // Sharp should be called twice (original + after re-encode)
      expect(sharp).toHaveBeenCalledTimes(2);
    });

    it('should throw PermanentImageError when Jimp re-encoding also fails', async () => {
      const jpegError = new Error(
        'VipsJpeg: Invalid SOS parameters for sequential JPEG',
      );

      // Sharp always fails
      const mockSharp = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(jpegError),
      };
      (sharp as unknown as jest.Mock).mockReturnValue(mockSharp);

      // Jimp re-encoding fails
      const jimpError = new Error('Jimp failed to read image');
      (Jimp.read as jest.Mock).mockRejectedValue(jimpError);

      await expect(service.resizeAndStoreImage(testDto)).rejects.toThrow(
        PermanentImageError,
      );

      // Should log repair failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ImageRepairFailed',
        'resizeImage',
        expect.objectContaining({
          originalError: jpegError.message,
          reencodeError: jimpError.message,
        }),
      );

      // Should log permanent failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ResizeAndStoreImagePermanentFailure',
        'resizeAndStoreImage',
        expect.objectContaining({
          code: 'RESIZE_PERMANENT_FAILURE',
        }),
      );
    });

    it('should throw PermanentImageError when Sharp fails again after successful Jimp re-encoding', async () => {
      const jpegError = new Error(
        'VipsJpeg: Invalid SOS parameters for sequential JPEG',
      );

      // Sharp always fails
      const mockSharp = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(jpegError),
      };
      (sharp as unknown as jest.Mock).mockReturnValue(mockSharp);

      // Jimp succeeds
      const mockJimpImage = {
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('reencoded-jpeg')),
      };
      (Jimp.read as jest.Mock).mockResolvedValue(mockJimpImage);

      await expect(service.resizeAndStoreImage(testDto)).rejects.toThrow(
        PermanentImageError,
      );

      // Should log that re-encoding succeeded
      expect(mockLogger.log).toHaveBeenCalledWith(
        'ImageReencoded',
        'resizeImage',
        expect.any(Object),
      );

      // Should log repair failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ImageRepairFailed',
        'resizeImage',
        expect.any(Object),
      );

      // Jimp should be called
      expect(Jimp.read).toHaveBeenCalled();
    });

    it('should not attempt Jimp re-encoding for non-JPEG errors', async () => {
      const networkError = new Error('Network timeout');

      const mockSharp = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(networkError),
      };
      (sharp as unknown as jest.Mock).mockReturnValue(mockSharp);

      await expect(service.resizeAndStoreImage(testDto)).rejects.toThrow(
        networkError,
      );

      // Should not attempt re-encoding
      expect(Jimp.read).not.toHaveBeenCalled();

      // Should log regular error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ResizeImageError',
        'resizeImage',
        expect.objectContaining({
          error: networkError.message,
        }),
      );

      // Should not log decode error
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'ResizeImageDecodeError',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should detect various JPEG error patterns', async () => {
      const errorPatterns = [
        'VipsJpeg: Invalid SOS parameters for sequential JPEG',
        'vipsjpeg: some other error',
        'JPEG decode error occurred',
        'Error processing jpeg image',
      ];

      for (const errorMessage of errorPatterns) {
        jest.clearAllMocks();

        const jpegError = new Error(errorMessage);
        let sharpCallCount = 0;

        (sharp as unknown as jest.Mock).mockImplementation(() => {
          sharpCallCount++;
          if (sharpCallCount === 1) {
            return {
              rotate: jest.fn().mockReturnThis(),
              resize: jest.fn().mockReturnThis(),
              webp: jest.fn().mockReturnThis(),
              toBuffer: jest.fn().mockRejectedValue(jpegError),
            };
          } else {
            return {
              rotate: jest.fn().mockReturnThis(),
              resize: jest.fn().mockReturnThis(),
              webp: jest.fn().mockReturnThis(),
              toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-data')),
            };
          }
        });

        const mockJimpImage = {
          getBuffer: jest.fn().mockResolvedValue(Buffer.from('reencoded-jpeg')),
        };
        (Jimp.read as jest.Mock).mockResolvedValue(mockJimpImage);

        mockStorage.uploadFileAtPath.mockResolvedValue({
          path: 'test/resized/path.webp',
          signedUrl: 'https://example.com/resized',
        });

        await service.resizeAndStoreImage(testDto);

        // Should attempt re-encoding for all patterns
        expect(Jimp.read).toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'ResizeImageDecodeError',
          'resizeImage',
          expect.any(Object),
        );
      }
    });
  });

  // #514 【バグ】原本が GCS に無い（404）ケースを恒久失敗として扱い、
  // Cloud Tasks にリトライさせないことを固定する。
  describe('original image download failures', () => {
    const testDto = {
      table: 'restaurants',
      column: 'image_path',
      recordId: '557b343a-91f7-4acd-833e-03b6f1c38e5e',
      size: 64 as 64 | 256 | 512 | 1024,
      originalPath:
        'production/google-maps/photo/1779284351007_ChIJqVya-RNbGGARr5imAY4tM64.jpg',
    };

    beforeEach(() => {
      mockStorage.fileExists.mockResolvedValue(false);
      mockStorage.generateSignedUrl.mockResolvedValue(
        'https://example.com/signed',
      );
    });

    const mockFetchStatus = (status: number, statusText: string) => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        statusText,
      } as any);
    };

    it('should treat 404 as a permanent failure so Cloud Tasks does not retry', async () => {
      mockFetchStatus(404, 'Not Found');

      const error = await service.resizeAndStoreImage(testDto).catch((e) => e);

      expect(error).toBeInstanceOf(PermanentImageError);
      expect((error as PermanentImageError).code).toBe(
        'ORIGINAL_IMAGE_NOT_FOUND',
      );

      // 恒久失敗と一時失敗をイベント名で区別できること
      expect(mockLogger.error).toHaveBeenCalledWith(
        'DownloadOriginalImagePermanentFailure',
        'downloadOriginalImage',
        expect.objectContaining({
          path: testDto.originalPath,
          status: 404,
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ResizeAndStoreImagePermanentFailure',
        'resizeAndStoreImage',
        expect.objectContaining({ code: 'ORIGINAL_IMAGE_NOT_FOUND' }),
      );
      // 一時失敗用のイベントは出さないこと
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'DownloadOriginalImageError',
        expect.any(String),
        expect.any(Object),
      );
    });

    it.each([410])('should treat %i as a permanent failure', async (status) => {
      mockFetchStatus(status, 'Gone');

      const error = await service.resizeAndStoreImage(testDto).catch((e) => e);

      expect(error).toBeInstanceOf(PermanentImageError);
      expect((error as PermanentImageError).code).toBe(
        'ORIGINAL_IMAGE_NOT_FOUND',
      );
    });

    // 一時的な 4xx を恒久扱いにすると、Cloud Tasks からジョブが消えて
    // その画像は二度とリサイズされない。署名付き URL は試行ごとに発行し直すので、
    // 次はいずれもリトライで成功しうる（レビュー指摘）。
    //   400: リクエスト組み立ての不備。原本の不在を意味しない
    //   403: 署名の期限切れ・クロックスキュー（ExpiredToken / SignatureDoesNotMatch）
    //   408 / 425: 一時的なタイムアウト
    it.each([400, 403, 408, 425])(
      'should keep %i retryable (a client error is not proof the original is gone)',
      async (status) => {
        mockFetchStatus(status, 'Client Error');

        const error = await service
          .resizeAndStoreImage(testDto)
          .catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(PermanentImageError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'DownloadOriginalImageError',
          'downloadOriginalImage',
          expect.objectContaining({ path: testDto.originalPath }),
        );
      },
    );

    it.each([429, 500, 502, 503])(
      'should keep %i retryable (not a permanent failure)',
      async (status) => {
        mockFetchStatus(status, 'Server Error');

        const error = await service
          .resizeAndStoreImage(testDto)
          .catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(PermanentImageError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'DownloadOriginalImageError',
          'downloadOriginalImage',
          expect.objectContaining({ path: testDto.originalPath }),
        );
      },
    );

    it('should keep network errors retryable', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));

      const error = await service.resizeAndStoreImage(testDto).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PermanentImageError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ResizeAndStoreImageError',
        'resizeAndStoreImage',
        expect.objectContaining({ error: 'ECONNRESET' }),
      );
    });
  });

  describe('PermanentImageError', () => {
    it('should create error with correct properties', () => {
      const error = new PermanentImageError('Test message', 'TEST_CODE', {
        detail1: 'value1',
        detail2: 123,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PermanentImageError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({
        detail1: 'value1',
        detail2: 123,
      });
      expect(error.name).toBe('PermanentImageError');
    });
  });
});
