// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaUsers } from '../../../../shared/converters/convert_users';

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.payouts.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
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
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.restaurant_bids.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
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
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
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
    data: Partial<Omit<PrismaUsers, 'created_at' | 'updated_at' | 'lock_no'>>,
  ) {
    const result = await this.prisma.prisma.users.update({
      where: { id: data.id },
      data: {
        ...data,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
    return result;
  }
}
