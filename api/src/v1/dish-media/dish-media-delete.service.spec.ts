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
//   ❷ 削除単位が「dish_media 1 件 + そのメディアに紐づく自分の最古のレビュー 1 件」であること
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

  it('自分の投稿は論理削除でき、紐づく自分の最古のレビューも一緒に消える', async () => {
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
    // owner の id を渡していることが要点。これが無いと
    // 他人が同じメディアへ書いたレビュー（review-from-media 経路）まで巻き添えで消える
    expect(repo.softDeleteDishMediaWithReviews).toHaveBeenCalledWith(
      TX,
      DISH_MEDIA_ID,
      OWNER_ID,
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

/**
 * #1513 リポジトリ側の「削除単位」を固定する。
 *
 * オーナー確定仕様の「投稿」= dish_media 1 件 + **そのメディアに紐づく自分の最古の
 * dish_review 1 件**。ここが崩れると
 *   - 他人のレビューを巻き添えにする（他人の文章が消える）
 *   - 自分の 2 本目以降のレビュー（= 別の投稿）まで消える
 * のどちらかが起きる。どちらも「消していない投稿が消える」ので、問い合わせの形で固定する。
 */
describe('DishMediaRepository #1513 softDeleteDishMediaWithReviews', () => {
  const OLDEST_REVIEW_ID = 'oldest-review-uuid';
  const DELETED_AT = new Date('2026-08-24T00:00:00.000Z');

  const makeRepo = (
    oldest: { id: string } | null = { id: OLDEST_REVIEW_ID },
  ) => {
    const findFirst = jest.fn().mockResolvedValue(oldest);
    const reviewUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const mediaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      dish_reviews: { findFirst, updateMany: reviewUpdateMany },
      dish_media: { updateMany: mediaUpdateMany },
    };
    const repo = new DishMediaRepository({} as never, {} as never, {} as never);
    return { repo, tx, findFirst, reviewUpdateMany, mediaUpdateMany };
  };

  it('巻き添えにするレビューは「自分の・未削除の・最古の」1 件だけ引く', async () => {
    const { repo, tx, findFirst } = makeRepo();

    await repo.softDeleteDishMediaWithReviews(
      tx as never,
      DISH_MEDIA_ID,
      OWNER_ID,
      DELETED_AT,
    );

    // findMany（= そのメディアに紐づく自分のレビュー全件）ではなく findFirst で 1 件。
    // 全件消すと、自分が後から書いた 2 本目以降（別の投稿）まで消える
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        created_dish_media_id: DISH_MEDIA_ID,
        // 他人のレビューを巻き添えにしないための条件。外すと他人の文章が消える
        user_id: OWNER_ID,
        deleted_at: null,
      },
      // 「最古」は created_at 昇順 + id で tie-break（オーナー確認済み）
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  });

  it('メディアとレビューを同じ deleted_at で論理削除し、消した id を返す', async () => {
    const { repo, tx, reviewUpdateMany, mediaUpdateMany } = makeRepo();

    const result = await repo.softDeleteDishMediaWithReviews(
      tx as never,
      DISH_MEDIA_ID,
      OWNER_ID,
      DELETED_AT,
    );

    expect(mediaUpdateMany).toHaveBeenCalledWith({
      // 既に消えている行を上書きしない（冪等）
      where: { id: DISH_MEDIA_ID, deleted_at: null },
      data: {
        deleted_at: DELETED_AT,
        updated_at: DELETED_AT,
        lock_no: { increment: 1 },
      },
    });
    expect(reviewUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [OLDEST_REVIEW_ID] } },
      data: {
        deleted_at: DELETED_AT,
        updated_at: DELETED_AT,
        lock_no: { increment: 1 },
      },
    });
    expect(result).toEqual({
      mediaDeleted: 1,
      deletedDishReviewIds: [OLDEST_REVIEW_ID],
    });
  });

  it('自分のレビューが 1 件も無い（他人のメディアではない写真だけの投稿）ならメディアだけ消す', async () => {
    const { repo, tx, reviewUpdateMany, mediaUpdateMany } = makeRepo(null);

    const result = await repo.softDeleteDishMediaWithReviews(
      tx as never,
      DISH_MEDIA_ID,
      OWNER_ID,
      DELETED_AT,
    );

    expect(mediaUpdateMany).toHaveBeenCalledTimes(1);
    // レビューが無いのに updateMany を投げない（空 IN は全件更新の事故になり得る）
    expect(reviewUpdateMany).not.toHaveBeenCalled();
    expect(result.deletedDishReviewIds).toEqual([]);
  });
});
