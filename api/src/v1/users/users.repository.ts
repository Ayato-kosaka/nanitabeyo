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
}
