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
  ) { }

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
