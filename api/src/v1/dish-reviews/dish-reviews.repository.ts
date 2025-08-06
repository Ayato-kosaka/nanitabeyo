// api/src/v1/dish-reviews/dish-reviews.repository.ts
//
// Repository for dish reviews operations
// Following the dish-media repository pattern

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';

import { CreateDishReviewDto } from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DishReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*                   1) Create dish review                           */
  /* ------------------------------------------------------------------ */
  async createDishReview(
    dto: CreateDishReviewDto,
    userId: string,
  ): Promise<PrismaDishReviews> {
    return this.prisma.dish_reviews.create({
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

  /* ------------------------------------------------------------------ */
  /*                   2) Like review (reactions table)                */
  /* ------------------------------------------------------------------ */
  async likeReview(reviewId: string, userId: string): Promise<void> {
    // First check if reaction already exists
    const existingReaction = await this.prisma.reactions.findFirst({
      where: {
        user_id: userId,
        target_type: 'dish_review',
        target_id: reviewId,
        action_type: 'like',
      },
    });

    if (!existingReaction) {
      await this.prisma.reactions.create({
        data: {
          id: crypto.randomUUID(),
          user_id: userId,
          target_type: 'dish_review',
          target_id: reviewId,
          action_type: 'like',
          created_at: new Date(),
          created_version: '1.0.0', // TODO: get from app context
          lock_no: 0,
        },
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*                   3) Get review author for notifications          */
  /* ------------------------------------------------------------------ */
  async getReviewAuthor(reviewId: string): Promise<string | null> {
    const review = await this.prisma.dish_reviews.findUnique({
      where: { id: reviewId },
      select: { user_id: true },
    });
    return review?.user_id || null;
  }

  /* ------------------------------------------------------------------ */
  /*                   4) Check if dish exists                         */
  /* ------------------------------------------------------------------ */
  async dishExists(dishId: string): Promise<boolean> {
    const count = await this.prisma.dishes.count({
      where: { id: dishId },
    });
    return count > 0;
  }
}