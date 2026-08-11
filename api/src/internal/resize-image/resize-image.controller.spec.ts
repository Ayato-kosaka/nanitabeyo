// api/src/internal/resize-image/resize-image.controller.spec.ts
//
// #514 【バグ】Cloud Tasks のリトライ制御をコントローラのレスポンスで固定する
//
// Cloud Tasks は 2xx を成功、それ以外をリトライ対象として扱う。
// 恒久失敗（PermanentImageError）はリトライしても決して成功しないため、
// コントローラは throw せず 204 で終端しなければならない。
//

import { Test, TestingModule } from '@nestjs/testing';
import { ResizeImageController } from './resize-image.controller';
import {
  ResizeImageService,
  PermanentImageError,
} from './resize-image.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ResizeImageDto } from './resize-image.dto';

jest.mock('src/core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    TASKS_INVOKER_SA: 'test@test.iam.gserviceaccount.com',
    CLOUD_RUN_URL: 'http://localhost:3000',
  },
}));

describe('ResizeImageController - Cloud Tasks retry semantics', () => {
  let controller: ResizeImageController;
  let mockService: jest.Mocked<ResizeImageService>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  const dto: ResizeImageDto = {
    table: 'restaurants',
    column: 'image_path',
    recordId: '557b343a-91f7-4acd-833e-03b6f1c38e5e',
    size: 64,
    originalPath:
      'production/google-maps/photo/1779284351007_ChIJqVya-RNbGGARr5imAY4tM64.jpg',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResizeImageController],
      providers: [
        {
          provide: ResizeImageService,
          useValue: { resizeAndStoreImage: jest.fn() },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    })
      // OIDCGuard は本テストの対象外
      .overrideGuard(require('../oidc.guard').OIDCGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ResizeImageController);
    mockService = module.get(ResizeImageService);
    mockLogger = module.get(AppLoggerService);
    jest.clearAllMocks();
  });

  it('should not throw (=> 204, no retry) when the original image is permanently unavailable', async () => {
    mockService.resizeAndStoreImage.mockRejectedValue(
      new PermanentImageError(
        'Failed to download image: 404 Not Found',
        'ORIGINAL_IMAGE_NOT_FOUND',
        { status: 404 },
      ),
    );

    await expect(controller.resizeImage(dto)).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'ResizeImagePermanentFailureAcknowledged',
      'resizeImage',
      expect.objectContaining({ code: 'ORIGINAL_IMAGE_NOT_FOUND' }),
    );
  });

  it('should not throw (=> 204, no retry) when the image is permanently undecodable', async () => {
    mockService.resizeAndStoreImage.mockRejectedValue(
      new PermanentImageError(
        'Failed to resize image even after re-encoding',
        'RESIZE_PERMANENT_FAILURE',
      ),
    );

    await expect(controller.resizeImage(dto)).resolves.toBeUndefined();
  });

  it('should rethrow (=> 5xx, retry) for transient errors', async () => {
    const transient = new Error('Failed to download image: 503 Unavailable');
    mockService.resizeAndStoreImage.mockRejectedValue(transient);

    await expect(controller.resizeImage(dto)).rejects.toThrow(transient);
  });

  it('should not throw on success', async () => {
    mockService.resizeAndStoreImage.mockResolvedValue({
      path: 'p.webp',
      signedUrl: 'https://example.com/p.webp',
      alreadyExisted: false,
    });

    await expect(controller.resizeImage(dto)).resolves.toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
