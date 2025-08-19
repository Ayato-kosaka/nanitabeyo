// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * ユーザーが投稿したレビューを取得（料理メディア情報含む）
   */
  async findUserDishReviews(userId: string, cursor?: string, limit = 42) {
    this.logger.debug('FindUserDishReviews', 'findUserDishReviews', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    // Get related dish_media for reviews that have created_dish_media_id
    const reviewsWithMedia = await Promise.all(
      result.map(async (review) => {
        let dish_media: any = null;
        if (review.created_dish_media_id) {
          dish_media = await this.prisma.prisma.dish_media.findUnique({
            where: { id: review.created_dish_media_id },
          });
        }
        return {
          ...review,
          dish_media,
        };
      }),
    );

    this.logger.debug('UserDishReviewsFound', 'findUserDishReviews', {
      count: reviewsWithMedia.length,
    });

    return reviewsWithMedia;
  }

  /**
   * ユーザーがいいねした料理メディアを取得
   */
  async findUserLikedDishMedia(userId: string, cursor?: string, limit = 42) {
    this.logger.debug('FindUserLikedDishMedia', 'findUserLikedDishMedia', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // Get liked dish media through dish_likes table
    const likedEntries = await this.prisma.prisma.dish_likes.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
      include: {
        dish_media: {
          include: {
            dishes: {
              include: {
                restaurants: true,
              },
            },
          },
        },
      },
    });

    // Get dish_reviews for each dish
    const result = await Promise.all(
      likedEntries.map(async (entry) => {
        const dish_reviews = await this.prisma.prisma.dish_reviews.findMany({
          where: {
            dish_id: entry.dish_media.dish_id,
          },
        });

        return {
          ...entry.dish_media,
          restaurants: entry.dish_media.dishes.restaurants,
          dishes: entry.dish_media.dishes,
          dish_reviews,
        };
      }),
    );

    this.logger.debug('UserLikedDishMediaFound', 'findUserLikedDishMedia', {
      count: result.length,
    });

    return result;
  }

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(userId: string, cursor?: string, limit = 42) {
    this.logger.debug('FindUserPayouts', 'findUserPayouts', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.payouts.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: result.length,
    });

    return result;
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(userId: string, cursor?: string, limit = 42) {
    this.logger.debug('FindUserRestaurantBids', 'findUserRestaurantBids', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: result.length,
    });

    return result;
  }

  /**
   * ユーザーが保存した料理カテゴリを取得
   */
  async findUserSavedDishCategories(
    userId: string,
    cursor?: string,
    limit = 42,
  ) {
    this.logger.debug(
      'FindUserSavedDishCategories',
      'findUserSavedDishCategories',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'DISH_CATEGORY',
      action_type: 'SAVE',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // Get saved categories through reactions table
    const savedEntries = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    // Get the actual dish categories
    const categoryIds = savedEntries.map((entry) => entry.target_id);
    const result = await this.prisma.prisma.dish_categories.findMany({
      where: {
        id: {
          in: categoryIds,
        },
      },
    });

    this.logger.debug(
      'UserSavedDishCategoriesFound',
      'findUserSavedDishCategories',
      {
        count: result.length,
      },
    );

    return result;
  }

  /**
   * ユーザーが保存した料理メディアを取得
   */
  async findUserSavedDishMedia(userId: string, cursor?: string, limit = 42) {
    this.logger.debug('FindUserSavedDishMedia', 'findUserSavedDishMedia', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
      target_type: 'DISH_MEDIA',
      action_type: 'SAVE',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    // Get saved dish media through reactions table
    const savedEntries = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    // Get the actual dish media with related data
    const mediaIds = savedEntries.map((entry) => entry.target_id);
    const mediaItems = await this.prisma.prisma.dish_media.findMany({
      where: {
        id: {
          in: mediaIds,
        },
      },
      include: {
        dishes: {
          include: {
            restaurants: true,
          },
        },
      },
    });

    // Get dish_reviews for each dish and format result
    const result = await Promise.all(
      mediaItems.map(async (media) => {
        const dish_reviews = await this.prisma.prisma.dish_reviews.findMany({
          where: {
            dish_id: media.dish_id,
          },
        });

        return {
          ...media,
          restaurants: media.dishes.restaurants,
          dishes: media.dishes,
          dish_reviews,
        };
      }),
    );

    this.logger.debug('UserSavedDishMediaFound', 'findUserSavedDishMedia', {
      count: result.length,
    });

    return result;
  }
}
