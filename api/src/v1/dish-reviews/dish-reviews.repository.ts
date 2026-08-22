// api/src/v1/dish-reviews/dish-reviews.repository.ts
//
// ❶ Prisma を使った DB アクセス層
// ❷ Service から呼ばれる具体的なクエリロジック
// ❸ トランザクション対応
//

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_APP_VERSION } from '../../core/cls/cls.constants';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDishReviewDto } from '@shared/v1/dto';

@Injectable()
export class DishReviewsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

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
        // 【設計】comment はユーザーが入力した本文を翻訳せず保存する。
        // original_language_code は本文そのものの言語を表すが、投稿時点では
        // 端末/アプリの入力言語に基づくため、ユーザーが別言語で書く可能性は残る。
        comment: dto.comment,
        original_language_code: dto.languageCode,
        rating: dto.rating,
        price_cents: dto.priceCents,
        currency_code: dto.currencyCode,
        // #1395 写真なしの「食べた」記録では undefined。列は 20260819T0000 で
        // nullable 化されるが、Prisma 生成物が追随するまで型は string のままなので
        // ここだけ明示的に緩める（再生成後はキャストを外せる。外さなくても意味は同じ）。
        created_dish_media_id:
          dto.createdDishMediaId ?? (null as unknown as string),
      },
    });
  }

  /**
   * レビューにいいね（リアクション追加）
   */
  async likeReview(reviewId: string, userId: string) {
    const appVersion = this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';

    return this.prisma.prisma.reactions.create({
      data: {
        user_id: userId,
        target_type: 'dish_reviews',
        target_id: reviewId,
        action_type: 'like',
        created_at: new Date(),
        created_version: appVersion,
        lock_no: 0,
      },
    });
  }

  /**
   * レビューのいいね解除（リアクション削除）
   */
  async unlikeReview(reviewId: string, userId: string) {
    return this.prisma.prisma.reactions.delete({
      where: {
        user_id_target_type_target_id_action_type: {
          user_id: userId,
          target_type: 'dish_reviews',
          target_id: reviewId,
          action_type: 'like',
        },
      },
    });
  }
}
