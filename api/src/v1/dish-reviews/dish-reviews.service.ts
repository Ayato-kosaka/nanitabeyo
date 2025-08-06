// api/src/v1/dish-reviews/dish-reviews.service.ts
//
// Service for dish reviews operations
// Following the dish-media service pattern

import { Injectable, NotFoundException } from '@nestjs/common';

import {
  CreateDishReviewDto,
  LikeDishReviewParamsDto,
} from '@shared/v1/dto';

import { DishReviewsRepository } from './dish-reviews.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishReviewsService {
  constructor(
    private readonly repo: DishReviewsRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-reviews                         */
  /* ------------------------------------------------------------------ */
  async createDishReview(dto: CreateDishReviewDto, userId: string) {
    this.logger.debug('CreateDishReview', 'createDishReview', {
      dishId: dto.dishId,
      userId: userId,
      rating: dto.rating,
    });

    // dishId が存在するか簡易バリデーション
    const dishExists = await this.repo.dishExists(dto.dishId);
    if (!dishExists) {
      this.logger.warn('DishNotFound', 'createDishReview', {
        dishId: dto.dishId,
      });
      throw new NotFoundException('Dish not found');
    }

    // レビュー作成
    const result = await this.repo.createDishReview(dto, userId);

    this.logger.log('DishReviewCreated', 'createDishReview', {
      reviewId: result.id,
      dishId: dto.dishId,
      rating: dto.rating,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes/:userId                 */
  /* ------------------------------------------------------------------ */
  async likeReview({ id, userId }: LikeDishReviewParamsDto) {
    this.logger.verbose('LikeDishReview', 'likeReview', { id, userId });
    
    // いいね追加
    await this.repo.likeReview(id, userId);

    // レビュー作者を取得して通知
    const reviewAuthorId = await this.repo.getReviewAuthor(id);
    
    if (reviewAuthorId && reviewAuthorId !== userId) {
      // For now, just log the notification instead of sending push
      // TODO: Implement push notification when user push tokens are available
      this.logger.log('ReviewLikeNotification', 'likeReview', {
        reviewId: id,
        reviewAuthorId: reviewAuthorId,
        likerId: userId,
        message: 'レビューが高評価！あなたのレビューがいいねされました',
      });
    }

    this.logger.log('DishReviewLiked', 'likeReview', {
      reviewId: id,
      userId: userId,
      authorNotified: !!reviewAuthorId,
    });
  }
}