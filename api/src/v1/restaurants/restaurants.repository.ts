// api/src/v1/restaurants/restaurants.repository.ts
//
// ❶ Repository for restaurants domain - database operations
// ❷ Following the pattern from dish-media/dish-media.repository.ts
// ❸ Handles database queries for restaurants, restaurant bids, and dish media

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { Prisma } from '../../../../shared/prisma/client';
import { QueryRestaurantsDto, QuerySavedRestaurantsDto } from '@shared/v1/dto';
import { DishMediaEntryEntity } from '../dish-media/dish-media.repository';
import { roundToOneDecimal } from '../../core/utils/backend-utils';

export type RestaurantWithMeta = {
  restaurant: PrismaRestaurants;
  meta: {
    reviewCount: number;
    averageRating: number;
    totalCents: number;
    maxEndDate: string | null;
  };
};

export type SavedRestaurantWithMeta = {
  restaurant: PrismaRestaurants;
  meta: {
    reviewCount: number;
    averageRating: number;
    lastSavedAt: Date | null;
  };
};

export type RestaurantDishMediaEntry = DishMediaEntryEntity & {
  dish: {
    reviewCount: number;
    averageRating: number;
  };
};

@Injectable()
export class RestaurantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*            近隣かつ「保存済み」のレストランを取得する。            */
  /* ------------------------------------------------------------------ */
  async searchNearbySavedRestaurants(
    dto: QuerySavedRestaurantsDto,
    userId: string,
  ): Promise<SavedRestaurantWithMeta[]> {
    this.logger.debug(
      'SearchNearbySavedRestaurants',
      'searchNearbySavedRestaurants',
      {
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        userId,
        limit: dto.limit,
      },
    );

    // 半径（m）→（km）
    const radiusInKm = dto.radius / 1000;
    // 緯度・経度のざっくりとしたバウンディングボックス用の度数（1度 ≒ 111km）

    // 生 SQL で集計。Prisma のテンプレートタグにより ${} 内はバインドパラメータとして扱われる。
    // - reactions / dish_media / dishes を辿って「保存された dish_media の属するレストラン」を抽出
    // - 保存日時（reactions.created_at）の降順でソート
    // - 距離フィルタは searchNearbyRestaurants と同じロジック（地球半径 6371km の球面三角法）
    const rawResult = await this.prisma.prisma.$queryRaw<
      (Pick<
        PrismaRestaurants,
        | 'id'
        | 'google_place_id'
        | 'name'
        | 'name_language_code'
        | 'latitude'
        | 'longitude'
        | 'image_url'
        | 'image_path'
        | 'address_components'
        | 'plus_code'
        | 'created_at'
        | 'source_seed_id'
        | 'source_names'
        | 'source_row_hash'
        | 'synced_at'
        | 'created_by_source'
      > & {
        review_count: number;
        average_rating: number;
        last_saved_at: Date | null;
      })[]
    >`
    WITH params AS (
      -- クエリ全体で共通して使うパラメータを WITH 句でまとめる
      SELECT
        ${dto.lat}::double precision    AS lat,
        ${dto.lng}::double precision    AS lng,
        ${radiusInKm}::double precision AS radius_km,
        ${userId}::uuid             AS user_id
    ),
    saved_restaurants AS (
      -- ユーザーが「保存」した dish_media 経由でレストランを特定する
      SELECT
        d.restaurant_id,
        -- 同じレストランが複数の dish_media 経由で保存されていても 1 行にまとめる
        MAX(rct.created_at) AS last_saved_at
      FROM reactions rct
      JOIN dish_media dm
        -- #1513 削除しても save の reaction は残る。ここで弾かないと
        -- 実体の無い投稿だけを根拠に店舗が「保存済み」として出続ける
        ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
      JOIN dishes d
        ON d.id = dm.dish_id
      JOIN params p
        ON TRUE
      WHERE
        rct.user_id     = p.user_id
        AND rct.action_type = 'save'
        AND rct.target_type = 'dish_media'
      GROUP BY d.restaurant_id
    ),
    candidates AS (
      /*
        #1629 【設計】**集計より前に «返す行» を確定させる。**

        旧実装は restaurants × dishes × dish_reviews を LEFT JOIN したうえで
        GROUP BY r.id して集計し、**そのあとで** ORDER BY / LIMIT していた。
        半径 5km の東京駅で該当 21,247 行あると、返すのは 20 行なのに
        21,247 店ぶんのレビュー集計を回すことになる（実測 9.3 秒）。

        ここでは «WHERE と ORDER BY と LIMIT/OFFSET» だけを先に済ませ、
        集計は残った limit 件に対してだけ行う。**絞る → 集計する** の順序が要。

        ⚠️ このメソッドの並び順は «保存日時の新しい順» であって距離順ではないので、
        KNN 演算子（location <-> 点）で «近い n 件» に切ることはできない
        （切ると «近い 20 件を保存日時で並べた先頭 20 件» になり、意味が変わる）。
        そのぶんここは «候補集合を先に確定させる» だけに留めている。
        もともとこの経路の駆動表は saved_restaurants（そのユーザーが保存した店だけ）
        なので、距離で 21,247 行に広がるのは集計の側であり、候補の側ではない。
      */
      SELECT
        r.id,
        sr.last_saved_at
      FROM saved_restaurants sr
      JOIN restaurants r
        ON r.id = sr.restaurant_id
      JOIN params p
        ON TRUE
      WHERE
      /*
        #1629 【修正】ST_DWithin + 既存の GIST 索引（idx_restaurants_location）で絞る。

        旧実装は latitude / longitude のバウンディングボックス + acos だったが、
        **この 2 列に btree が 1 本も無い**ため（全 migration を検査して確認）
        restaurants の Seq Scan になっていた。日本全体の viewport から
        「このエリアで再検索」を押すと半径が 1,000 km 級になり、全件走査 + 集計で
        「保存したお店の取得に失敗しました」に落ちるほど遅くなる。

        restaurants.location は GENERATED ALWAYS AS
        (ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography) STORED で、
        元になる latitude / longitude は NOT NULL。つまり **NULL になり得ない**ので、
        haversine 版から乗り換えても «location が NULL の店だけ消える» は起きない
        （schema.prisma は生成列を表現できず nullable + DEFAULT に見えるが、DDL が正）。
        ⚠️ この SQL はテンプレートリテラルの中である。**コメントにバッククォートを書かないこと**
           （文字列がそこで閉じる。#1375 で実際に踏んだ）。

        ⚠️ geography の ST_DWithin は既定で回転楕円体で測るので、真球の haversine とは
           境界付近で 0.3% 程度ずれる（より正確になる方向）。
      */
      ST_DWithin(
        r.location,
        ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
        p.radius_km * 1000
      )
      -- 「保存」日時の新しい順にソート（外側の ORDER BY と同一。ここで確定させる）
      ORDER BY
        sr.last_saved_at DESC
      LIMIT ${dto.limit ?? 20}
      OFFSET ${dto.offset ?? 0}
    )
    SELECT
      r.id,
      r.google_place_id,
      r.name,
      r.name_language_code,
      r.latitude,
      r.longitude,
      r.image_url,
      r.image_path,
      r.address_components,
      r.plus_code,
      r.created_at,
      -- #843 catalog 同期の metadata。GROUP BY は r.id（主キー）なので
      -- 関数従属で r.* を選べる（GROUP BY への追記は要らない）
      r.source_seed_id,
      r.source_names,
      r.source_row_hash,
      r.synced_at,
      -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
      r.created_by_source,
      COUNT(dr.id)::int                    AS review_count,
      COALESCE(AVG(dr.rating), 0)::double precision AS average_rating,
      c.last_saved_at
    FROM candidates c
    JOIN restaurants r
      ON r.id = c.id
    -- レビュー集計用に dishes / dish_reviews を LEFT JOIN。
    -- #1629 candidates で limit 件に絞ったあとなので、集計対象は最大 limit 店ぶん
    LEFT JOIN dishes d
      ON d.restaurant_id = r.id
    LEFT JOIN dish_reviews dr
      -- #1513 削除済みレビューを件数・平均に混ぜない
      ON dr.dish_id = d.id AND dr.deleted_at IS NULL
    GROUP BY
      r.id,
      c.last_saved_at
    ORDER BY
      c.last_saved_at DESC;
  `;

    // メタ情報を詰め替えてドメイン層で扱いやすい形にして返す
    return rawResult.map((row) => ({
      restaurant: {
        id: row.id,
        google_place_id: row.google_place_id,
        name: row.name,
        name_language_code: row.name_language_code,
        latitude: row.latitude,
        longitude: row.longitude,
        image_url: row.image_url,
        image_path: row.image_path,
        address_components: row.address_components,
        plus_code: row.plus_code,
        created_at: row.created_at,
        source_seed_id: row.source_seed_id,
        source_names: row.source_names,
        source_row_hash: row.source_row_hash,
        synced_at: row.synced_at,
        created_by_source: row.created_by_source,
      },
      meta: {
        reviewCount: row.review_count,
        averageRating: roundToOneDecimal(row.average_rating),
        lastSavedAt: row.last_saved_at,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                    Restaurant search queries (nearby + bidding status)                    */
  /* ------------------------------------------------------------------ */
  async searchNearbyRestaurants(
    tx: Prisma.TransactionClient,
    // #1375 4 巡目: `orderByDistance` はキャプション住所での照合用。住所は «店そのもの» を
    // 指しているので、入札額順で 100 件に切ると肝心の店が落ちる（独立レビュー指摘 #3）。
    // API の公開 DTO には出さず、サーバ内部の呼び出しだけが指定できる形にしておく
    dto: QueryRestaurantsDto & { orderByDistance?: boolean },
  ): Promise<RestaurantWithMeta[]> {
    this.logger.debug('SearchNearbyRestaurants', 'searchNearbyRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // 半径はそのまま m で使う（ST_DWithin の geography 版は m を取る）
    const radiusInMeters = dto.radius;

    // #1395 店名の部分一致（自前 restaurants テーブル。Google Places は呼ばない）。
    // ユーザー入力の % / _ / \ は LIKE のワイルドカードとして解釈されてしまうので、
    // バインドする前にエスケープする（ESCAPE '\' は ILIKE の既定）。
    const nameQuery = dto.q?.trim() ? dto.q.trim() : null;
    const escapedNameQuery = nameQuery
      ? nameQuery.replace(/[\\%_]/g, (c) => `\\${c}`)
      : null;
    const nameFilter = escapedNameQuery
      ? Prisma.sql`AND r.name ILIKE ${'%' + escapedNameQuery + '%'}`
      : Prisma.empty;
    // 店名で絞ったときは入札額順ではなく距離順にする。
    // 店舗選択 UI で「一蘭」と打った結果が入札額で並ぶのは不自然なため
    // 距離式は SELECT に出さない（返却行に余計な列を混ぜないため）。
    // GROUP BY r.id に対して r の列だけから成る式は関数従属なので ORDER BY に直接書ける
    const orderByDistance = Boolean(escapedNameQuery || dto.orderByDistance);
    const limit = dto.limit ?? 20;
    // 検索地点。ST_DWithin / ST_Distance / KNN（<->）のすべてで同じ点を使う
    const originPoint = Prisma.sql`ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography`;

    /*
      #1629 【設計】**候補は «スポンサー枠 + 近傍枠» の 2 本立てで、必ず limit 件に収める。**

      ## 何が問題だったか

      「日本全体を映して『このエリアで再検索』を押すと必ず 0 件」（オーナー報告）。
      真因はクライアント側の 50km clamp だが、**clamp を外すだけだとサーバが持たない**。
      旧実装（#1629 前半）の既定経路は

        nearby   = 半径内の restaurants を «全部»（LIMIT 無し）
        candidates = その全部に restaurant_bids を LEFT JOIN して GROUP BY し、
                     total_cents 降順で limit 件へ切る

      という形で、半径が全国規模になると «全国の店 × 入札» を集計してから 20 行に切る
      ことになる。半径 5km の東京駅ですら 21,247 行の集計だったので、全国では話にならない。

      ## どう変えたか（食べログ等の «全国から優先順で N 件» と同じ構え）

      1. **スポンサー枠**（`sponsored`）… 駆動表を restaurants ではなく
         **restaurant_bids**（有効な入札だけ）にする。有効な入札を持つ店は
         全店舗数に対して桁違いに少ないので、全国規模でも先に絞れる。
         並びは従来どおり **入札額（total_cents）の降順**。
      2. **近傍枠**（`nearest`）… スポンサーで埋まらない残りを、
         **地図の中心から近い順**（KNN。`location <-> 点`）で埋める。
         KNN は GIST 索引から «近い順に n 件» を直接取り出すので、
         半径がいくら大きくても走る行数は limit 件ぶんで一定である。
      3. 重いレビュー集計（dishes × dish_reviews）は、どちらの枝でも
         候補が limit 件に確定したあとでしか走らない（従来どおり）。

      これで «半径 = 見えている範囲» にしても «0 件» にも «全国集計» にもならない。

      ⚠️ **入札額順（課金）の意味は変えていない。**
         «有効な入札を持つ店が、入札額の降順で先頭に来る» は従来と同じである。
         変わったのは **その後ろ**で、以前は «半径内の入札なし店が total_cents=0 で
         同着（＝並び順は不定）» だったところが «中心から近い順» になった。
         スポンサー枠を件数で間引いたり、入札額以外の要素で並べ替えたりはしていない。
         （なお半径の上限を外したことで、以前は 50km で見えなかった «遠くのスポンサー» が
         引きの表示で見えるようになる。広告の露出は減る方向には変わらない）

      ⚠️ 距離順の経路（店名検索 / 住所照合 = orderByDistance）は従来どおり
         **KNN のみ**である。店名で絞った結果が入札額で並ぶのは不自然なため（#1395）。

      ⚠️ **索引の申し送り（未適用）。** スポンサー枠は `restaurant_bids` を
         «status = paid かつ 期間内» で絞る。この 3 列の複合索引は無く、いまは
         `idx_restaurant_bids_restaurant`（restaurant_id 単独）しかないため、
         この CTE は restaurant_bids の Seq Scan になる。有効な入札の行数が
         数万を超えたら次の索引が要る（migration はオーナー承認制なので、
         ここでは作らずに申し送りだけ残す）:
           CREATE INDEX idx_restaurant_bids_active
             ON restaurant_bids (status, end_date, start_date)
             INCLUDE (restaurant_id, amount_cents);
    */
    // 候補 CTE。距離順と既定（入札額順）で組み立てが変わる。
    // どちらの枝も «tier / total_cents / max_end_date» を持つ形に揃え、
    // 最終 SELECT 側を 1 本にしている。
    const candidatesCte = orderByDistance
      ? Prisma.sql`
      nearby AS (
        -- #1629 距離順のときは KNN（location <-> 点）で GIST 索引から «近い順に limit 件» を直接取る
        SELECT r.id
        FROM restaurants r
        WHERE
          -- #1629 ST_DWithin + 既存 GIST（詳細は searchNearbySavedRestaurants 側のコメント）
          ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
          ${nameFilter}
        ORDER BY r.location <-> ${originPoint} LIMIT ${limit}
      ),
      candidates AS (
        -- 入札の集計は restaurant_bids だけを見る（レビュー集計と同じ GROUP BY に混ぜない）
        SELECT
          n.id,
          0 AS tier,
          COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
          MAX(rb.end_date) AS max_end_date
        FROM nearby n
        LEFT JOIN restaurant_bids rb ON rb.restaurant_id = n.id
          AND rb.start_date <= CURRENT_DATE
          AND rb.end_date > CURRENT_DATE
          AND rb.status = 'paid'
        GROUP BY n.id
      )`
      : Prisma.sql`
      sponsored AS (
        -- #1629 スポンサー枠。**駆動表は restaurant_bids**（有効な入札だけ）。
        -- 全国規模の半径でも、ここを restaurants から駆動しない限り行数は増えない
        SELECT
          rb.restaurant_id AS id,
          SUM(rb.amount_cents)::double precision AS total_cents,
          MAX(rb.end_date) AS max_end_date
        FROM restaurant_bids rb
        JOIN restaurants r ON r.id = rb.restaurant_id
        WHERE
          rb.status = 'paid'
          AND rb.start_date <= CURRENT_DATE
          AND rb.end_date > CURRENT_DATE
          AND ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
          ${nameFilter}
        GROUP BY rb.restaurant_id
        ORDER BY total_cents DESC LIMIT ${limit}
      ),
      nearest AS (
        -- #1629 近傍枠。スポンサーで埋まらない残りを «中心から近い順» で埋める。
        -- ここが «引くと 0 件» を構造的に消している（半径内に入札が 1 件も無くても必ず埋まる）
        SELECT r.id
        FROM restaurants r
        WHERE
          ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
          ${nameFilter}
          AND NOT EXISTS (SELECT 1 FROM sponsored s WHERE s.id = r.id)
        ORDER BY r.location <-> ${originPoint} LIMIT ${limit}
      ),
      candidates AS (
        SELECT id, 0 AS tier, total_cents, max_end_date FROM sponsored
        UNION ALL
        SELECT id, 1 AS tier, 0::double precision AS total_cents, NULL::date AS max_end_date FROM nearest
      )`;
    const orderBy = orderByDistance
      ? // #1629 距離順も geography で測る。WHERE の ST_DWithin と同じ土俵にしておかないと、
        // 「絞り込みには入っているのに並び順だけ別の距離」という食い違いが起きうる
        Prisma.sql`ORDER BY ST_Distance(r.location, ${originPoint}) ASC`
      : // #1629 スポンサー（入札額の降順）→ 中心から近い順。tier がスポンサー枠かどうか
        Prisma.sql`ORDER BY c.tier ASC, c.total_cents DESC, ST_Distance(r.location, ${originPoint}) ASC`;

    const rawResult = await tx.$queryRaw<
      (Pick<
        PrismaRestaurants,
        | 'id'
        | 'google_place_id'
        | 'name'
        | 'name_language_code'
        | 'latitude'
        | 'longitude'
        | 'image_url'
        | 'image_path'
        | 'address_components'
        | 'plus_code'
        | 'created_at'
        | 'source_seed_id'
        | 'source_names'
        | 'source_row_hash'
        | 'synced_at'
        | 'created_by_source'
      > & {
        review_count: number;
        average_rating: number;
        total_cents: number;
        max_end_date: string | null;
      })[]
    >(Prisma.sql`
      WITH ${candidatesCte}
      SELECT
        r.id,
        r.google_place_id,
        r.name,
        r.name_language_code,
        r.latitude,
        r.longitude,
        r.image_url,
        r.image_path,
        r.address_components,
        r.plus_code,
        r.created_at,
        -- #843 catalog 同期の metadata（GROUP BY r.id への関数従属で選べる）
        r.source_seed_id,
        r.source_names,
        r.source_row_hash,
        r.synced_at,
        -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
        r.created_by_source,
        c.total_cents,
        c.max_end_date,
        COUNT(dr.id)::int AS review_count,
        COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
      FROM candidates c
      JOIN restaurants r
        ON r.id = c.id
      LEFT JOIN dishes d
        ON d.restaurant_id = r.id
      LEFT JOIN dish_reviews dr
        -- #1513 削除済みレビューを件数・平均に混ぜない
        ON dr.dish_id = d.id AND dr.deleted_at IS NULL
      GROUP BY r.id, c.tier, c.total_cents, c.max_end_date
      ${orderBy}
      LIMIT ${limit};
    `);

    return rawResult.map((row) => ({
      restaurant: row,
      meta: {
        reviewCount: row.review_count,
        averageRating: roundToOneDecimal(row.average_rating),
        totalCents: Number(row.total_cents) || 0,
        maxEndDate: row.max_end_date || null,
      },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*                   Restaurant detail queries (by ID)                    */
  /* ------------------------------------------------------------------ */
  async findRestaurantById(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<PrismaRestaurants | null> {
    return tx.restaurants.findUnique({
      where: { id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*               Restaurant detail queries (by Google Place ID)               */
  /* ------------------------------------------------------------------ */
  async findRestaurantByGooglePlaceId(
    tx: Prisma.TransactionClient,
    google_place_id: string,
  ): Promise<PrismaRestaurants | null> {
    return tx.restaurants.findUnique({
      where: { google_place_id },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                   Restaurant review statistics (count + average rating)                       */
  /* ------------------------------------------------------------------ */
  async getRestaurantReviewStats(
    tx: Prisma.TransactionClient,
    restaurant_id: string,
  ) {
    this.logger.debug('GetRestaurantReviewStats', 'getRestaurantReviewStats', {
      restaurant_id,
    });
    const result = await tx.dish_reviews.aggregate({
      where: {
        dishes: { restaurant_id },
        deleted_at: null, // #1513 削除済みレビューを件数・平均に混ぜない
      },
      _count: { _all: true }, // Review count
      _avg: { rating: true }, // Average rating
    });
    const reviewCount = result._count?._all ?? 0;
    const averageRating = roundToOneDecimal(result._avg?.rating ?? 0);

    return {
      reviewCount,
      averageRating,
    };
  }

  /* ------------------------------------------------------------------ */
  /*        Restaurant bid statistics (totalCents + maxEndDate)         */
  /* ------------------------------------------------------------------ */
  async getRestaurantBidStats(
    tx: Prisma.TransactionClient,
    restaurant_id: string,
  ) {
    this.logger.debug('GetRestaurantBidStats', 'getRestaurantBidStats', {
      restaurant_id,
    });

    const result = await tx.restaurant_bids.aggregate({
      where: {
        restaurant_id,
        start_date: { lte: new Date() },
        end_date: { gt: new Date() },
        status: 'paid',
      },
      _sum: { amount_cents: true }, // total amount
      _max: { end_date: true }, // latest end date
    });

    const totalCents = result._sum?.amount_cents
      ? Number(result._sum.amount_cents)
      : 0;
    const maxEndDate = result._max?.end_date ?? null;

    return {
      totalCents,
      maxEndDate,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                          Check if restaurant exists                          */
  /* ------------------------------------------------------------------ */
  async restaurantExists(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const count = await tx.restaurants.count({
      where: { id },
    });
    return count > 0;
  }
}
