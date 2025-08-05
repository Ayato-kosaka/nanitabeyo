// api/src/modules/dish-media/dish-media.repository.ts
//
// 🎯 目的
//   • Prisma を “1 つのデータ取得 API” として隠蔽し、Service から直アクセスさせない
//   • 地理検索 / 重複チェック / トランザクション更新 を 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';

import {
  CreateDishMediaDto,
  QueryDishMediaDto,
  LikeDishMediaParamsDto,
  SaveDishMediaParamsDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface DishMediaFeedItem {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

@Injectable()
export class DishMediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*   1) 料理メディアを位置 + カテゴリ + 未閲覧 で取得（返却数固定）    */
  /* ------------------------------------------------------------------ */
  async findDishMedias(
    { location, radius, categoryId }: QueryDishMediaDto,
    viewerId?: string,
  ): Promise<DishMediaFeedItem[]> {
    // Haversine 距離 (PostgreSQL + PostGIS) の簡易例
    // RAW を使うときはバインド変数で SQL Injection を防止
    const [lat, lng] = location.split(',').map(Number);
    const meters = radius; // already in metres

    return this.prisma.$queryRaw<DishMediaFeedItem[]>(
      Prisma.sql`
      SELECT
        r.id AS restaurant_id,
        r.name,
        r.location,
        d.id AS dish_id,
        d.name AS dish_name,
        d.category_id,
        dm.id AS dish_media_id,
        dm.media_path,
        dm.media_type,
        dm.created_at,
        json_agg(
          json_build_object(
            'id', dr.id,
            'user_id', dr.user_id,
            'rating', dr.rating,
            'comment', dr.comment,
            'created_at', dr.created_at
          ) ORDER BY dr.created_at DESC
        ) AS dish_reviews
      FROM restaurants r
        JOIN dishes d        ON d.restaurant_id = r.id
        JOIN dish_media dm   ON dm.dish_id = d.id
        LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
      WHERE
        ( ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat})) <= ${meters} )
        AND (${categoryId} IS NULL OR d.category_id = ${categoryId})
        AND (
          ${viewerId} IS NULL OR
          dm.id NOT IN (
            SELECT dish_media_id FROM user_seen_dish WHERE user_id = ${viewerId}
          )
        )
      GROUP BY r.id, d.id, dm.id
      ORDER BY dm.created_at DESC
      LIMIT 1;
    `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*                     2) いいね / いいね解除                         */
  /* ------------------------------------------------------------------ */
  async likeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.dish_likes.upsert({
      where: { dish_media_id_user_id: { dish_media_id: id, user_id: userId } },
      update: {},
      create: {
        dish_media_id: id,
        user_id: userId,
      },
    });
  }

  async unlikeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.dish_likes.deleteMany({
      where: { dish_media_id: id, user_id: userId },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                     3) 保存（reactions テーブル想定）               */
  /* ------------------------------------------------------------------ */
  async saveDishMedia(id: string, userId: string): Promise<void> {
    // TODO: migration
    // await this.prisma.reactions.upsert({
    //     where: { dish_media_id_user_id: { dish_media_id: id, user_id: userId } },
    //     update: { type: 'SAVE' },
    //     create: { dish_media_id: id, user_id: userId, type: 'SAVE' },
    // });
  }

  /* ------------------------------------------------------------------ */
  /*                            4) Dish 存在確認                        */
  /* ------------------------------------------------------------------ */
  async dishExists(dishId: string): Promise<boolean> {
    const cnt = await this.prisma.dishes.count({ where: { id: dishId } });
    return cnt > 0;
  }

  /* ------------------------------------------------------------------ */
  /*        5) dish_media 投稿 (トランザクション内で呼び出し)           */
  /* ------------------------------------------------------------------ */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dto: CreateDishMediaDto,
    creatorId: string,
    thumbnailPath: string,
  ) {
    // 画像は既に Storage へアップ済みとして mediaPath を受け取る
    const newMedia = await tx.dish_media.create({
      data: {
        dish_id: dto.dishId,
        user_id: creatorId,
        media_path: dto.mediaPath,
        media_type: dto.mediaType,
        thumbnail_path: thumbnailPath,
      },
    });

    // “本人を既読”にするなど副次レコードを入れたければここで
    // TODO: migration
    // await tx.user_seen_dish.create({
    //     data: { user_id: creatorId, dish_media_id: newMedia.id },
    // });

    return newMedia;
  }
}
