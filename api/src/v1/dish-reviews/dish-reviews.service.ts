// api/src/v1/dish-reviews/dish-reviews.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import { CreateDishReviewDto, LikeDishReviewParamsDto } from '@shared/v1/dto';

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
