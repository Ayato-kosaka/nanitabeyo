// api/src/v1/dish-reviews/dish-reviews.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  CreateDishReviewDto,
  LikeDishReviewParamsDto,
} from '@shared/v1/dto';

import { DishReviewsRepository } from './dish-reviews.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifierService } from '../../core/notifier/notifier.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishReviewsService {
  constructor(
    private readonly repo: DishReviewsRepository,
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly logger: AppLoggerService,
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
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes/:userId (いいね)          */
  /* ------------------------------------------------------------------ */
  async likeDishReview({ id, userId }: LikeDishReviewParamsDto) {
    this.logger.verbose('LikeDishReview', 'likeDishReview', { id, userId });

    // レビューが存在するか確認
    const reviewExists = await this.repo.reviewExists(id);
    if (!reviewExists) {
      this.logger.warn('ReviewNotFound', 'likeDishReview', { reviewId: id });
      throw new NotFoundException('Review not found');
    }

    // リアクション追加
    const reaction = await this.repo.likeReview(id, userId);

    // レビュー作成者を取得してプッシュ通知送信
    const review = await this.repo.getReviewById(id);
    if (review?.user_id && review.user_id !== userId) {
      // 非同期通知（失敗してもレスポンスに影響させない）
      // TODO: ユーザーのプッシュトークンを取得する必要がある
      // this.notifier
      //   .sendPush([{
      //     to: userPushToken, // 実際のExpoプッシュトークンが必要
      //     title: 'レビューが高評価！',
      //     body: `あなたのレビューがいいねされました`,
      //   }])
      //   .catch((err) =>
      //     this.logger.warn('PushLikeNotificationFailed', 'likeDishReview', {
      //       error: err.message,
      //       reviewId: id,
      //       userId,
      //     }),
      //   );
    }

    this.logger.debug('ReviewLiked', 'likeDishReview', {
      reviewId: id,
      userId,
      reactionId: reaction.id,
    });
  }
}