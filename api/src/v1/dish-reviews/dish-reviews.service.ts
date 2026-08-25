// api/src/v1/dish-reviews/dish-reviews.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  CreateDishReviewDto,
  LikeDishReviewParamsDto,
  UpdateDishReviewDto,
} from '@shared/v1/dto';
import type { DeleteDishReviewResponse } from '@shared/v1/res';

import { DishReviewsRepository } from './dish-reviews.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';

@Injectable()
export class DishReviewsService {
  constructor(
    private readonly repo: DishReviewsRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly cloudTasks: CloudTasksService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-reviews (投稿)                   */
  /* ------------------------------------------------------------------ */
  async createDishReview(dto: CreateDishReviewDto, userId: string) {
    this.logger.debug('CreateDishReview', 'createDishReview', {
      dishId: dto.dishId,
      userId: userId,
    });

    // dishId が存在するか簡易バリデーション
    const dishExists = await this.repo.dishExists(dto.dishId);
    if (!dishExists) {
      this.logger.warn('DishNotFound', 'createDishReview', {
        dishId: dto.dishId,
      });
      throw new NotFoundException('Dish not found');
    }

    // トランザクションで dish_reviews 作成
    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishReview(tx, dto, userId),
    );

    this.logger.log('DishReviewCreated', 'createDishReview', {
      reviewId: result.id,
      dishId: dto.dishId,
    });

    // #460 【設計】作成されたレビュー情報を返却
    return convertPrismaToSupabase_DishReviews(result);
  }

  /* ------------------------------------------------------------------ */
  /*                PATCH /v1/dish-reviews/:id (編集) #1513              */
  /* ------------------------------------------------------------------ */
  /**
   * 自分のレビューのテキスト系項目だけを更新する。
   *
   * 【メディアは差し替えない】
   * `UpdateDishReviewDto` にメディア系フィールドが無く、Controller の ValidationPipe は
   * `whitelist: true` なので、クライアントが `createdDishMediaId` などを送っても
   * Service へは届かない。ここで媒体列を書かないこと自体が仕様の担保である。
   *
   * 【認可】
   * `user_id` が呼び出しユーザーと一致しない場合は 403。Google import 由来のレビューは
   * `user_id = null` なので、この比較で自動的に弾かれる。
   *
   * 【競合検知】
   * `lock_no` 不一致は 409。後から来た編集が黙って先の編集を上書きしない。
   */
  async updateDishReview(
    reviewId: string,
    dto: UpdateDishReviewDto,
    userId: string,
  ) {
    this.logger.debug('UpdateDishReview', 'updateDishReview', {
      reviewId,
      userId,
      lockNo: dto.lockNo,
    });

    const review = await this.repo.findReviewForMutation(reviewId);
    if (!review) {
      this.logger.warn('ReviewNotFound', 'updateDishReview', { reviewId });
      throw new NotFoundException('Review not found');
    }
    if (review.user_id !== userId) {
      // 他人のレビューを編集させない。存在は隠さず 403 で明確に拒否する
      this.logger.warn('ReviewNotOwned', 'updateDishReview', {
        reviewId,
        userId,
        ownerId: review.user_id,
      });
      throw new ForbiddenException('Not the owner of this review');
    }
    if (review.deleted_at) {
      // 消えたものは編集できない。復活の口を作らない
      this.logger.warn('ReviewAlreadyDeleted', 'updateDishReview', {
        reviewId,
      });
      throw new NotFoundException('Review not found');
    }

    const data: Prisma.dish_reviewsUpdateInput = {};
    if (dto.comment !== undefined) data.comment = dto.comment;
    if (dto.languageCode !== undefined)
      data.original_language_code = dto.languageCode;
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.priceCents !== undefined) data.price_cents = dto.priceCents;
    if (dto.currencyCode !== undefined) data.currency_code = dto.currencyCode;

    const updatedCount = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.updateDishReviewWithLock(tx, reviewId, dto.lockNo, data),
    );

    if (updatedCount === 0) {
      // ここに来るのは「読んだあとに誰か(自分の別端末を含む)が更新した」場合。
      // 直前の findReviewForMutation で削除も所有者も確認済みなので、残る理由は lock_no のズレ
      this.logger.warn('ReviewLockConflict', 'updateDishReview', {
        reviewId,
        userId,
        expectedLockNo: dto.lockNo,
        currentLockNo: review.lock_no,
      });
      throw new ConflictException('Review was updated by another session');
    }

    const updated = await this.repo.getReviewRowById(reviewId);
    if (!updated) {
      throw new NotFoundException('Review not found');
    }

    this.logger.log('DishReviewUpdated', 'updateDishReview', {
      reviewId,
      lockNo: updated.lock_no,
    });

    return convertPrismaToSupabase_DishReviews(updated);
  }

  /* ------------------------------------------------------------------ */
  /*               DELETE /v1/dish-reviews/:id (削除) #1513              */
  /* ------------------------------------------------------------------ */
  /**
   * 自分のレビューを論理削除する。
   *
   * 【削除単位】ここで消えるのは **レビュー 1 件だけ**。紐づく dish_media は消さない。
   * 「投稿ごと消す」のは `DELETE /v1/dish-media/:id` の役割で、そちらは巻き添えで
   * このレビューも消す。オーナー確定仕様の「レビューを消せば投稿も消える、という
   * 意味ではない」に対応している。
   *
   * 【冪等】既に削除済みで、かつ自分のものであれば成功として返す。
   * 連打や再送で 404 を返しても利用者にできることは無く、UI が無駄にエラーを出すだけ。
   */
  async deleteDishReview(
    reviewId: string,
    userId: string,
  ): Promise<DeleteDishReviewResponse> {
    this.logger.debug('DeleteDishReview', 'deleteDishReview', {
      reviewId,
      userId,
    });

    const review = await this.repo.findReviewForMutation(reviewId);
    if (!review) {
      this.logger.warn('ReviewNotFound', 'deleteDishReview', { reviewId });
      throw new NotFoundException('Review not found');
    }
    if (review.user_id !== userId) {
      this.logger.warn('ReviewNotOwned', 'deleteDishReview', {
        reviewId,
        userId,
        ownerId: review.user_id,
      });
      throw new ForbiddenException('Not the owner of this review');
    }
    if (review.deleted_at) {
      return { id: reviewId, deletedAt: review.deleted_at.toISOString() };
    }

    const deletedAt = new Date();
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.softDeleteDishReview(tx, reviewId, deletedAt),
    );

    this.logger.log('DishReviewDeleted', 'deleteDishReview', {
      reviewId,
      userId,
    });

    return { id: reviewId, deletedAt: deletedAt.toISOString() };
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes (いいね)                 */
  /* ------------------------------------------------------------------ */
  async likeDishReview(
    { id }: LikeDishReviewParamsDto,
    userId: string,
    isAnonymous: boolean,
  ) {
    this.logger.verbose('LikeDishReview', 'likeDishReview', { id, userId });

    // レビューが存在するか確認
    const exists = await this.repo.reviewExists(id);
    if (!exists) {
      this.logger.warn('ReviewNotFound', 'likeDishReview', { reviewId: id });
      throw new NotFoundException('Review not found');
    }

    // リアクション追加
    const reaction = await this.repo.likeReview(id, userId);

    // #通知機能 【設計】成功時に Cloud Tasks にジョブ投入（匿名ユーザーは除外）
    if (!isAnonymous) {
      const idempotencyKey = `${reaction.target_type}:${reaction.action_type}:${id}`;
      this.cloudTasks
        .enqueueNotification({
          actionType: 'like',
          targetTable: 'dish_reviews',
          targetId: id,
          actorId: userId,
          idempotencyKey,
        })
        .catch((error) => {
          this.logger.error('EnqueueNotificationFailed', 'likeDishReview', {
            reviewId: id,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  /* ------------------------------------------------------------------ */
  /*            DELETE /v1/dish-reviews/:id/likes (いいね解除)           */
  /* ------------------------------------------------------------------ */
  async unlikeDishReview({ id }: LikeDishReviewParamsDto, userId: string) {
    this.logger.verbose('UnlikeDishReview', 'unlikeDishReview', { id, userId });

    // レビューが存在するか確認
    const exists = await this.repo.reviewExists(id);
    if (!exists) {
      this.logger.warn('ReviewNotFound', 'unlikeDishReview', { reviewId: id });
      throw new NotFoundException('Review not found');
    }

    // リアクション削除
    await this.repo.unlikeReview(id, userId);

    // #通知機能 【設計】いいね解除時は通知を送信しない
  }
}
