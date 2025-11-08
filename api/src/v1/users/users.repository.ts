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
   * 指定されたIDのユーザーを取得
   */
  async getUserByIds(userId: string[]) {
    return this.prisma.prisma.users.findMany({
      where: {
        id: { in: userId },
      },
    });
  }

  /**
   * 指定されたIDのユーザーを1件取得
   */
  async getUserById(userId: string) {
    return this.prisma.prisma.users.findUnique({
      where: { id: userId },
    });
  }

  /**
   * ユーザープロフィールを更新
   */
  async updateUserProfile(
    userId: string,
    data: {
      display_name?: string;
      bio?: string;
      avatar_path?: string;
      preferred_locale?: string;
    },
  ) {
    this.logger.debug('UpdateUserProfile', 'updateUserProfile', {
      userId,
      hasDisplayName: !!data.display_name,
      hasBio: !!data.bio,
      hasAvatarPath: !!data.avatar_path,
      hasPreferredLocale: !!data.preferred_locale,
    });

    const result = await this.prisma.prisma.users.update({
      where: { id: userId },
      data: {
        ...data,
        updated_at: new Date(),
      },
    });

    this.logger.log('UserProfileUpdated', 'updateUserProfile', {
      userId,
    });

    return result;
  }
}
