// api/src/v1/dish-media/dish-media-delete.service.spec.ts
//
// #1513 UGC-01「自分の投稿を削除する」の不変条件を固定する。
//
// 既存の dish-media.service.spec.ts と分けているのは、あちらが
// 「テレメトリの FK 違反ハンドリング」という別の主題に閉じているため。
// 同じ suite に混ぜると beforeEach のモック構成が両方の都合を抱えて読めなくなる。
//
// ここで守りたいのは 3 つ。
//   ❶ 他人の投稿を削除できないこと（サーバー側での認可）
//   ❷ 削除単位が「dish_media 1 件 + その投稿と一緒に作られたレビュー」であること
//   ❸ 論理削除であること（行を消さず deleted_at を立てる）
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DishMediaService } from './dish-media.service';
import { DishMediaRepository } from './dish-media.repository';
import { DishMediaAssembler } from './dish-media.assembler';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { ClsService } from 'nestjs-cls';

const DISH_MEDIA_ID = 'dish-media-uuid';
const OWNER_ID = 'owner-uuid';
const OTHER_ID = 'other-uuid';
/** withTransaction のパススルー用ダミー tx */
const TX = { __tx: true } as never;

describe('DishMediaService #1513 投稿の削除', () => {
  let service: DishMediaService;
  let repo: {
    findDishMediaForMutation: jest.Mock;
    softDeleteDishMediaWithReviews: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findDishMediaForMutation: jest.fn(),
      softDeleteDishMediaWithReviews: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishMediaService,
        { provide: DishMediaRepository, useValue: repo },
        { provide: DishMediaAssembler, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            withTransaction: jest.fn((fn: (tx: never) => unknown) => fn(TX)),
          },
        },
        {
          provide: AppLoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            verbose: jest.fn(),
          },
        },
        { provide: TranscoderService, useValue: {} },
        {
          provide: CloudTasksService,
          useValue: { enqueueNotification: jest.fn() },
        },
        { provide: ClsService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(DishMediaService);
  });

  it('自分の投稿は論理削除でき、一緒に作られたレビューも巻き添えで消える', async () => {
    repo.findDishMediaForMutation.mockResolvedValue({
      id: DISH_MEDIA_ID,
      user_id: OWNER_ID,
      deleted_at: null,
    });
    repo.softDeleteDishMediaWithReviews.mockResolvedValue({
      mediaDeleted: 1,
      deletedDishReviewIds: ['review-uuid'],
    });

    const result = await service.deleteDishMedia(DISH_MEDIA_ID, OWNER_ID);

    expect(result.id).toBe(DISH_MEDIA_ID);
    expect(result.deletedDishReviewIds).toEqual(['review-uuid']);
    expect(repo.softDeleteDishMediaWithReviews).toHaveBeenCalledWith(
      TX,
      DISH_MEDIA_ID,
      expect.any(Date),
    );
  });

  it('他人の投稿は削除できない（403）', async () => {
    repo.findDishMediaForMutation.mockResolvedValue({
      id: DISH_MEDIA_ID,
      user_id: OWNER_ID,
      deleted_at: null,
    });

    await expect(
      service.deleteDishMedia(DISH_MEDIA_ID, OTHER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.softDeleteDishMediaWithReviews).not.toHaveBeenCalled();
  });

  it('Google import 由来（user_id = null）は誰も削除できない', async () => {
    repo.findDishMediaForMutation.mockResolvedValue({
      id: DISH_MEDIA_ID,
      user_id: null,
      deleted_at: null,
    });

    await expect(
      service.deleteDishMedia(DISH_MEDIA_ID, OWNER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('削除済みの再削除は冪等（既存の deleted_at を返し、上書きしない）', async () => {
    const deletedAt = new Date('2026-08-22T00:00:00.000Z');
    repo.findDishMediaForMutation.mockResolvedValue({
      id: DISH_MEDIA_ID,
      user_id: OWNER_ID,
      deleted_at: deletedAt,
    });

    const result = await service.deleteDishMedia(DISH_MEDIA_ID, OWNER_ID);

    expect(result.deletedAt).toBe(deletedAt.toISOString());
    expect(repo.softDeleteDishMediaWithReviews).not.toHaveBeenCalled();
  });

  it('存在しない投稿は 404', async () => {
    repo.findDishMediaForMutation.mockResolvedValue(null);

    await expect(
      service.deleteDishMedia(DISH_MEDIA_ID, OWNER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
