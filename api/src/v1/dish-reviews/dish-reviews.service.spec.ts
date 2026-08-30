// api/src/v1/dish-reviews/dish-reviews.service.spec.ts
//
// #1513 UGC-01「自分の投稿・レビューを編集／削除する」の不変条件を固定する。
//
// ここで守りたいのは 3 つだけで、どれも「壊れたことに気づけない」種類の欠陥である。
//   ❶ 他人のレビューを編集・削除できないこと（サーバー側での認可）
//   ❷ 同時編集が後勝ちにならないこと（lock_no による競合検知）
//   ❸ 削除が論理削除であること（deleted_at を立てるだけで、行を消さない）
//

// core/config/env は import 時に process.env をバリデーションして throw するため、
// 実DB・実APIに触れない単体テストでも .env が無いと suite ごと落ちる。
// dish-reviews.service.ts は repository / logger 経由でこれを推移的に読み込むので、
// DI で差し替えるより手前、モジュール解決の段階で無害化する。
jest.mock('../../core/config/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) =>
        key === 'DB_POOL_MAX' ? 1 : `test-${key}`,
    },
  ),
}));

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DishReviewsService } from './dish-reviews.service';
import { DishReviewsRepository } from './dish-reviews.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import type { UpdateDishReviewDto } from '@shared/v1/dto';

const OWNER_ID = 'owner-uuid';
const OTHER_ID = 'other-uuid';
const REVIEW_ID = 'review-uuid';
/** withTransaction のパススルー用ダミー tx */
const TX = { __tx: true } as never;

/** dish_reviews の 1 行（レスポンス組み立てに必要な列だけ埋める） */
const buildReviewRow = (overrides: Record<string, unknown> = {}) => ({
  id: REVIEW_ID,
  dish_id: 'dish-uuid',
  comment: '編集後のコメント',
  original_language_code: 'ja',
  user_id: OWNER_ID,
  rating: 4,
  price_cents: 1200,
  currency_code: 'JPY',
  created_dish_media_id: 'media-uuid',
  imported_user_name: null,
  imported_user_avatar: null,
  created_at: new Date('2026-08-01T00:00:00.000Z'),
  updated_at: new Date('2026-08-23T00:00:00.000Z'),
  lock_no: 1,
  deleted_at: null,
  ...overrides,
});

describe('DishReviewsService #1513 編集・削除', () => {
  let service: DishReviewsService;
  let repo: jest.Mocked<
    Pick<
      DishReviewsRepository,
      | 'findReviewForMutation'
      | 'updateDishReviewWithLock'
      | 'getReviewRowById'
      | 'softDeleteDishReview'
    >
  >;

  beforeEach(async () => {
    repo = {
      findReviewForMutation: jest.fn(),
      updateDishReviewWithLock: jest.fn(),
      getReviewRowById: jest.fn(),
      softDeleteDishReview: jest.fn(),
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DishReviewsService,
        { provide: DishReviewsRepository, useValue: repo },
        {
          provide: PrismaService,
          useValue: {
            // withTransaction は tx を渡して呼ぶだけのパススルーにする
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
        {
          provide: CloudTasksService,
          useValue: { enqueueNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DishReviewsService);
  });

  const dto = (overrides: Partial<UpdateDishReviewDto> = {}) =>
    ({
      lockNo: 0,
      comment: '編集後のコメント',
      rating: 4,
      ...overrides,
    }) as UpdateDishReviewDto;

  /* ---------------------------------------------------------------- */
  /*                             編集                                  */
  /* ---------------------------------------------------------------- */
  describe('updateDishReview', () => {
    it('自分のレビューはテキスト系項目を更新できる', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);
      repo.updateDishReviewWithLock.mockResolvedValue(1);
      repo.getReviewRowById.mockResolvedValue(buildReviewRow() as never);

      const result = await service.updateDishReview(
        REVIEW_ID,
        dto({ lockNo: 0 }),
        OWNER_ID,
      );

      expect(result.comment).toBe('編集後のコメント');
      expect(repo.updateDishReviewWithLock).toHaveBeenCalledWith(
        TX,
        REVIEW_ID,
        0,
        expect.objectContaining({ comment: '編集後のコメント', rating: 4 }),
      );
    });

    it('メディア列は絶対に書き換えない（オーナー確定仕様: メディアは差し替え不可）', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);
      repo.updateDishReviewWithLock.mockResolvedValue(1);
      repo.getReviewRowById.mockResolvedValue(buildReviewRow() as never);

      // Controller の ValidationPipe(whitelist) を素通りしたと仮定して、
      // DTO に無いメディア系フィールドを混ぜても data に載らないことを確かめる
      await service.updateDishReview(
        REVIEW_ID,
        {
          ...dto(),
          createdDishMediaId: 'attacker-media-uuid',
          media_path: 'uploads/attacker.jpg',
        } as unknown as UpdateDishReviewDto,
        OWNER_ID,
      );

      const data = repo.updateDishReviewWithLock.mock.calls[0][3];
      expect(Object.keys(data)).toEqual(
        expect.not.arrayContaining([
          'created_dish_media_id',
          'media_path',
          'thumbnail_path',
        ]),
      );
    });

    it('他人のレビューは編集できない（403）', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);

      await expect(
        service.updateDishReview(REVIEW_ID, dto(), OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.updateDishReviewWithLock).not.toHaveBeenCalled();
    });

    it('Google import 由来（user_id = null）は誰も編集できない', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: null,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);

      await expect(
        service.updateDishReview(REVIEW_ID, dto(), OWNER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('削除済みのレビューは編集できない（404）', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 3,
        deleted_at: new Date('2026-08-22T00:00:00.000Z'),
        created_dish_media_id: 'media-uuid',
      } as never);

      await expect(
        service.updateDishReview(REVIEW_ID, dto({ lockNo: 3 }), OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateDishReviewWithLock).not.toHaveBeenCalled();
    });

    it('存在しないレビューは 404', async () => {
      repo.findReviewForMutation.mockResolvedValue(null as never);

      await expect(
        service.updateDishReview(REVIEW_ID, dto(), OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('同時編集は後勝ちにならない（lock_no 不一致は 409）', async () => {
      // 2 つのセッションが lock_no = 0 を読んだ状態を作る。
      // 先に走ったほうが lock_no を 1 に進めるので、後から来たほうの
      // updateMany は 0 件になる = 上書きが成立しない。
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);
      repo.getReviewRowById.mockResolvedValue(
        buildReviewRow({ comment: '先に通った編集', lock_no: 1 }) as never,
      );
      repo.updateDishReviewWithLock
        .mockResolvedValueOnce(1) // 1 本目: lock_no = 0 に当たる
        .mockResolvedValueOnce(0); // 2 本目: 既に lock_no = 1 なので当たらない

      const first = await service.updateDishReview(
        REVIEW_ID,
        dto({ lockNo: 0, comment: '先に通った編集' }),
        OWNER_ID,
      );
      expect(first.comment).toBe('先に通った編集');

      await expect(
        service.updateDishReview(
          REVIEW_ID,
          dto({ lockNo: 0, comment: '後から来た編集' }),
          OWNER_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  /* ---------------------------------------------------------------- */
  /*                             削除                                  */
  /* ---------------------------------------------------------------- */
  describe('deleteDishReview', () => {
    it('自分のレビューは論理削除できる（行は消さず deleted_at を立てる）', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);
      repo.softDeleteDishReview.mockResolvedValue(1);

      const result = await service.deleteDishReview(REVIEW_ID, OWNER_ID);

      expect(result.id).toBe(REVIEW_ID);
      expect(result.deletedAt).toEqual(expect.any(String));
      expect(repo.softDeleteDishReview).toHaveBeenCalledWith(
        TX,
        REVIEW_ID,
        expect.any(Date),
      );
    });

    it('他人のレビューは削除できない（403）', async () => {
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 0,
        deleted_at: null,
        created_dish_media_id: 'media-uuid',
      } as never);

      await expect(
        service.deleteDishReview(REVIEW_ID, OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.softDeleteDishReview).not.toHaveBeenCalled();
    });

    it('削除済みの再削除は冪等（既存の deleted_at を返し、上書きしない）', async () => {
      const deletedAt = new Date('2026-08-22T00:00:00.000Z');
      repo.findReviewForMutation.mockResolvedValue({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        lock_no: 1,
        deleted_at: deletedAt,
        created_dish_media_id: 'media-uuid',
      } as never);

      const result = await service.deleteDishReview(REVIEW_ID, OWNER_ID);

      expect(result.deletedAt).toBe(deletedAt.toISOString());
      expect(repo.softDeleteDishReview).not.toHaveBeenCalled();
    });

    it('存在しないレビューは 404', async () => {
      repo.findReviewForMutation.mockResolvedValue(null as never);

      await expect(
        service.deleteDishReview(REVIEW_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
