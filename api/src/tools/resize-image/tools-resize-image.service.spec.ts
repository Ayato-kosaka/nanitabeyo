// api/src/tools/resize-image/tools-resize-image.service.spec.ts
//
// #514 【設計】再 enqueue は「明示指定された recordId のみ」であることを固定する
//

import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ToolsResizeImageService } from './tools-resize-image.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  ReEnqueueResizeImageDto,
  RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS,
} from '@shared/v1/dto';

jest.mock('src/core/config/env', () => ({
  env: {
    API_NODE_ENV: 'test',
    GCP_PROJECT: 'test-project',
    TASKS_LOCATION: 'us-central1',
    CLOUD_RUN_URL: 'http://localhost:3000',
    TASKS_INVOKER_SA: 'test@test.iam.gserviceaccount.com',
  },
}));

const RESTAURANT_ID = '557b343a-91f7-4acd-833e-03b6f1c38e5e';
const DISH_MEDIA_ID = '5f482536-4aab-4deb-8ab8-f6f36259d4d9';

describe('ToolsResizeImageService', () => {
  let service: ToolsResizeImageService;
  let mockCloudTasks: jest.Mocked<CloudTasksService>;
  let prismaMock: {
    restaurants: { findUnique: jest.Mock };
    dish_media: { findUnique: jest.Mock };
    users: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prismaMock = {
      restaurants: { findUnique: jest.fn() },
      dish_media: { findUnique: jest.fn() },
      users: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolsResizeImageService,
        { provide: PrismaService, useValue: { prisma: prismaMock } },
        {
          provide: CloudTasksService,
          useValue: {
            enqueueResizeImage: jest.fn().mockResolvedValue(undefined),
          },
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
    }).compile();

    service = module.get(ToolsResizeImageService);
    mockCloudTasks = module.get(CloudTasksService);
  });

  it('should enqueue the production sizes for an explicitly given restaurant record', async () => {
    prismaMock.restaurants.findUnique.mockResolvedValue({
      image_path: 'production/google-maps/photo/x.jpg',
    });

    const result = await service.reEnqueue({
      targets: [
        { table: 'restaurants', column: 'image_path', recordId: RESTAURANT_ID },
      ],
    });

    expect(result.enqueuedTasks).toBe(2);
    expect(result.results[0].status).toBe('enqueued');
    expect(result.results[0].enqueuedSizes).toEqual([256, 64]);
    expect(mockCloudTasks.enqueueResizeImage).toHaveBeenCalledWith({
      table: 'restaurants',
      column: 'image_path',
      recordId: RESTAURANT_ID,
      size: 256,
      aspectRatio: 9 / 16,
      originalPath: 'production/google-maps/photo/x.jpg',
    });
  });

  it('should enqueue only the requested sizes when specified', async () => {
    prismaMock.restaurants.findUnique.mockResolvedValue({
      image_path: 'production/google-maps/photo/x.jpg',
    });

    const result = await service.reEnqueue({
      targets: [
        {
          table: 'restaurants',
          column: 'image_path',
          recordId: RESTAURANT_ID,
          sizes: [64],
        },
      ],
    });

    expect(result.enqueuedTasks).toBe(1);
    expect(mockCloudTasks.enqueueResizeImage).toHaveBeenCalledTimes(1);
    expect(mockCloudTasks.enqueueResizeImage).toHaveBeenCalledWith(
      expect.objectContaining({ size: 64 }),
    );
  });

  it('should pick the column-specific path for dish_media', async () => {
    prismaMock.dish_media.findUnique.mockResolvedValue({
      media_path: 'production/media.jpg',
      thumbnail_path: 'production/thumb.jpg',
    });

    await service.reEnqueue({
      targets: [
        {
          table: 'dish_media',
          column: 'thumbnail_path',
          recordId: DISH_MEDIA_ID,
        },
      ],
    });

    expect(mockCloudTasks.enqueueResizeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        column: 'thumbnail_path',
        originalPath: 'production/thumb.jpg',
        size: 256,
      }),
    );
  });

  it('should skip without enqueueing when the record does not exist', async () => {
    prismaMock.restaurants.findUnique.mockResolvedValue(null);

    const result = await service.reEnqueue({
      targets: [
        { table: 'restaurants', column: 'image_path', recordId: RESTAURANT_ID },
      ],
    });

    expect(result.enqueuedTasks).toBe(0);
    expect(result.results[0].status).toBe('skipped_record_not_found');
    expect(mockCloudTasks.enqueueResizeImage).not.toHaveBeenCalled();
  });

  it('should skip without enqueueing when the original path is empty', async () => {
    prismaMock.restaurants.findUnique.mockResolvedValue({ image_path: null });

    const result = await service.reEnqueue({
      targets: [
        { table: 'restaurants', column: 'image_path', recordId: RESTAURANT_ID },
      ],
    });

    expect(result.enqueuedTasks).toBe(0);
    expect(result.results[0].status).toBe('skipped_original_path_empty');
    expect(mockCloudTasks.enqueueResizeImage).not.toHaveBeenCalled();
  });

  it('should reject unsupported table/column combinations', async () => {
    const result = await service.reEnqueue({
      targets: [
        {
          table: 'restaurants',
          column: 'avatar_path',
          recordId: RESTAURANT_ID,
        },
      ],
    });

    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].reason).toContain('Unsupported table/column');
    expect(mockCloudTasks.enqueueResizeImage).not.toHaveBeenCalled();
  });

  it('should keep going and report per-target failures', async () => {
    prismaMock.restaurants.findUnique.mockResolvedValue({
      image_path: 'production/a.jpg',
    });
    prismaMock.dish_media.findUnique.mockResolvedValue({
      media_path: 'production/media.jpg',
      thumbnail_path: 'production/thumb.jpg',
    });
    mockCloudTasks.enqueueResizeImage
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined);

    const result = await service.reEnqueue({
      targets: [
        { table: 'restaurants', column: 'image_path', recordId: RESTAURANT_ID },
        {
          table: 'dish_media',
          column: 'media_path',
          recordId: DISH_MEDIA_ID,
        },
      ],
    });

    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].reason).toBe('quota exceeded');
    expect(result.results[1].status).toBe('enqueued');
  });

  // #514 全件再実行（本番 476,637 件）を絶対に起こさないためのガード
  describe('bulk-run guard', () => {
    const validateDto = async (plain: unknown) =>
      validate(plainToInstance(ReEnqueueResizeImageDto, plain));

    it('should reject an empty target list (no implicit "all")', async () => {
      const errors = await validateDto({ targets: [] });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject a missing target list', async () => {
      const errors = await validateDto({});
      expect(errors.length).toBeGreaterThan(0);
    });

    it(`should reject more than ${RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS} targets`, async () => {
      const targets = Array.from(
        { length: RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS + 1 },
        () => ({
          table: 'restaurants',
          column: 'image_path',
          recordId: RESTAURANT_ID,
        }),
      );

      const errors = await validateDto({ targets });
      expect(
        errors.some((e) => e.constraints?.arrayMaxSize !== undefined),
      ).toBe(true);
    });

    it('should reject a non-uuid recordId', async () => {
      const errors = await validateDto({
        targets: [
          { table: 'restaurants', column: 'image_path', recordId: '*' },
        ],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it(`should accept exactly ${RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS} targets`, async () => {
      const targets = Array.from(
        { length: RE_ENQUEUE_RESIZE_IMAGE_MAX_TARGETS },
        () => ({
          table: 'restaurants',
          column: 'image_path',
          recordId: RESTAURANT_ID,
        }),
      );

      expect(await validateDto({ targets })).toEqual([]);
    });
  });
});
