// api/src/v1/dish-reviews/dish-reviews.repository.ts
//
// ❶ Prisma を使った DB アクセス層
// ❷ Service から呼ばれる具体的なクエリロジック
// ❸ トランザクション対応
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDishReviewDto } from '@shared/v1/dto';

@Injectable()
export class DishReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 料理が存在するかチェック
   */
  async dishExists(dishId: string): Promise<boolean> {
    const count = await this.prisma.prisma.dishes.count({
      where: { id: dishId },
    });
    return count > 0;
  }

  /**
   * レビューが存在するかチェック
   */
  async reviewExists(reviewId: string): Promise<boolean> {
    const count = await this.prisma.prisma.dish_reviews.count({
      where: { id: reviewId },
    });
    return count > 0;
  }

  /**
   * レビューを ID で取得
   */
  async getReviewById(reviewId: string) {
    return this.prisma.prisma.dish_reviews.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        user_id: true,
        dish_id: true,
        comment: true,
        rating: true,
        created_at: true,
      },
    });
  }

  /**
   * 料理レビューを作成
   */
  async createDishReview(
    tx: Prisma.TransactionClient,
    dto: CreateDishReviewDto,
    userId: string,
  ) {
    return tx.dish_reviews.create({
      data: {
        dish_id: dto.dishId,
        user_id: userId,
        comment: dto.comment,
        rating: dto.rating,
        price_cents: dto.priceCents,
        currency_code: dto.currencyCode,
        created_dish_media_id: dto.createdDishMediaId,
      },
    });
  }

  /**
   * レビューにいいね（リアクション追加）
   */
  async likeReview(reviewId: string, userId: string) {
    // Generate a unique ID for the reaction
    const reactionId = `${userId}_${reviewId}_like_${Date.now()}`;

    return this.prisma.prisma.reactions.create({
      data: {
        id: reactionId,
        user_id: userId,
        target_type: 'dish_review',
        target_id: reviewId,
        action_type: 'like',
        created_at: new Date(),
        created_version: '1.0.0', // TODO: 実際のバージョンを取得
        lock_no: 0,
      },
    });
  }
}
