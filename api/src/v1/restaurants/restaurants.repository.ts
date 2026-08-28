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
    // 店名で絞ったときは «投稿が多い順» ではなく距離順にする。
    // 店舗選択 UI で「一蘭」と打った結果が投稿数で並ぶのは不自然なため
    // （«いま見ている地図の中から目的の店を選ぶ» 画面なので、近い順が素直）。
    // 距離式は SELECT に出さない（返却行に余計な列を混ぜないため）。
    // GROUP BY r.id に対して r の列だけから成る式は関数従属なので ORDER BY に直接書ける
    const orderByDistance = Boolean(escapedNameQuery || dto.orderByDistance);
    const limit = dto.limit ?? 20;
    // 検索地点。ST_DWithin / ST_Distance / KNN（<->）のすべてで同じ点を使う
    const originPoint = Prisma.sql`ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography`;

    /*
      #1629 【設計】**候補は «投稿枠 + 近傍枠» の 2 本立てで、必ず limit 件に収める。**

      ## 並びを «入札額順» から «投稿が多い順» へ変えた（オーナー指示）

      オーナー指示は「入札順にしなくて良いです。一旦投稿が多い順とかが良いかな？」。
      もともと既定の並びは «有効な入札の合計額（total_cents）の降順» だったが、
      dev の `restaurant_bids` は実測 0 行で、有効な入札を持つ店も 0 件である。
      つまりこの並びは実質「全店が同着 → 先頭 limit 件は不定」でしかなかった。

      **«投稿» は `dish_media`（削除済みを除く）と定義する。** 理由は 2 つ:
        - このリポジトリの語彙で «投稿» は dish_media を指し、`dish_reviews` は
          «レビュー» と呼び分けられている（content_reports の分類がその正本）。
          ユーザーが «たくさん投稿されている店» と感じるのは、フィードに並ぶ動画・写真の数である
        - `dish_reviews` はテキストだけの記録（媒体なし）も含みうるので、
          «お店の賑わい» の代理指標としては dish_media のほうが素直

      ⚠️ 返している `review_count` は流用できない。あれは «候補を limit 件に絞ったあと» に
         集計している値で、並べ替えの前には存在しない（存在させると下の「順序」が壊れる）。

      ## 何が問題だったか（性能。ここは #1629 前半から変えていない）

      「日本全体を映して『このエリアで再検索』を押すと必ず 0 件」（オーナー報告）。
      真因はクライアント側の 50km clamp だが、**clamp を外すだけだとサーバが持たない**。
      «半径内の restaurants を全部（57 万件）集計してから並べて limit 件へ切る» 形は、
      半径 5km の東京駅ですら 21,247 行の集計で 9.3 秒かかっていた。

      ## どう変えたか（**絞る → 集計する** の順序は死守する）

      1. **投稿枠**（`posted`）… 駆動表を restaurants ではなく **dish_media** にする。
         投稿を持つ店は全店舗数（57 万）に対して桁違いに少ないので、全国規模の半径でも
         «投稿の行数» でしか行数が増えない。並びは **投稿数の降順 → 中心から近い順**。
         かつてのスポンサー枠が `restaurant_bids` を駆動表にしていたのと同じ構えで、
         駆動表を «入札» から «投稿» へ差し替えただけである。
      2. **近傍枠**（`nearest`）… 投稿枠で埋まらない残りを **中心から近い順**（KNN。
         `location <-> 点`）で埋める。KNN は GIST 索引から «近い順に n 件» を直接取り出すので、
         半径がいくら大きくても走る行数は limit 件ぶんで一定である。
         投稿ゼロの店はここに入り、**投稿数 0 の同着なので «近い順»** になる（並びの定義と矛盾しない）。
      3. 重いレビュー集計（dishes × dish_reviews）と入札集計（restaurant_bids）は、
         どちらの枝でも候補が limit 件に確定したあとでしか走らない。

      これで «半径 = 見えている範囲» にしても «0 件» にも «全国集計» にもならない。

      ## 入札（restaurant_bids / total_cents / max_end_date）は残す

      **並び替えには一切使わないが、返却する meta からは消していない。**
      `QueryRestaurantsResponse` / `GetRestaurantByIdResponse` など shared の契約と
      app-expo の画面（入札状況の表示）が totalCents / maxEndDate を参照しており、
      契約から消すと影響範囲が課金機能そのものへ広がる。並びから外す今回の指示に対して
      «消す» は過剰なので、**候補が limit 件に決まったあとに集計して返すだけ**にした
      （もとの距離順の枝がやっていたのと同じ形。集計対象は最大 limit 店ぶん）。

      ⚠️ 距離順の経路（店名検索 / 住所照合 = orderByDistance）は従来どおり **KNN のみ**である。

      ⚠️ **索引の申し送り（未適用。migration はオーナー承認制なのでここでは作らない）。**
         投稿枠は «生存している dish_media → dishes → restaurants» を辿って店ごとに数える。
         いま効くのは `idx_dish_media_alive_dish (dish_id) WHERE deleted_at IS NULL` と
         `idx_dishes_restaurant (restaurant_id)` で、**dish_media の行数に比例**して重くなる。
         投稿が数百万行に育ったら、次のどちらかが要る:
           (a) restaurants に投稿数の非正規化列（例 `post_count`）を置いてトリガで更新し、
               `(post_count DESC)` の btree で «上位 n 件» を直接取り出す
           (b) 集計済みのマテリアライズドビュー（restaurant_id, post_count）を定期更新する
         どちらも «投稿数で並べつつ走る行数を limit 件で一定にする» ための索引であり、
         現在の実装（dish_media 駆動）はその前段の、追加スキーマ無しで済む版である。
    */
    // 候補 CTE。距離順と既定（投稿が多い順）で組み立てが変わる。
    // どちらの枝も «tier / post_count / total_cents / max_end_date» を持つ形に揃え、
    // 最終 SELECT 側を 1 本にしている。
    // 有効な入札（並びには使わないが meta として返す）の集計条件。
    // 候補が limit 件に確定したあとにしか使わない
    const activeBidJoin = Prisma.sql`
        LEFT JOIN restaurant_bids rb ON rb.restaurant_id = b.id
          AND rb.start_date <= CURRENT_DATE
          AND rb.end_date > CURRENT_DATE
          AND rb.status = 'paid'`;
    // #1629 投稿数（削除済みを除く dish_media）。候補 1 件ずつの相関副問い合わせで、
    // 走るのは候補（最大 limit 件）ぶんだけ。idx_dishes_restaurant → idx_dish_media_alive_dish
    const postCountOfCandidate = Prisma.sql`
          (
            SELECT COUNT(*)::int
            FROM dishes d2
            JOIN dish_media dm2 ON dm2.dish_id = d2.id AND dm2.deleted_at IS NULL
            WHERE d2.restaurant_id = b.id
          )`;
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
      base AS (
        SELECT n.id, 0 AS tier FROM nearby n
      ),
      candidates AS (
        -- 入札・投稿数の集計は candidates の中で完結させる（レビュー集計と同じ GROUP BY に混ぜない）
        SELECT
          b.id,
          b.tier,
          ${postCountOfCandidate} AS post_count,
          COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
          MAX(rb.end_date) AS max_end_date
        FROM base b
        ${activeBidJoin}
        GROUP BY b.id, b.tier
      )`
      : Prisma.sql`
      posted AS (
        -- #1629 投稿枠。**駆動表は dish_media**（生存している投稿だけ）。
        -- 全国規模の半径でも、ここを restaurants から駆動しない限り行数は店舗数で増えない。
        -- #1513 削除済みの投稿は数えない
        SELECT
          d.restaurant_id AS id,
          COUNT(*)::int AS post_count,
          MIN(ST_Distance(r.location, ${originPoint})) AS distance_m
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        JOIN restaurants r ON r.id = d.restaurant_id
        WHERE
          dm.deleted_at IS NULL
          AND ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
          ${nameFilter}
        GROUP BY d.restaurant_id
        -- 同数なら中心から近い順。«どの limit 件を残すか» を最終 ORDER BY と一致させる
        ORDER BY post_count DESC, distance_m ASC LIMIT ${limit}
      ),
      nearest AS (
        -- #1629 近傍枠。投稿枠で埋まらない残りを «中心から近い順» で埋める。
        -- ここが «引くと 0 件» を構造的に消している（半径内に投稿が 1 件も無くても必ず埋まる）
        SELECT r.id
        FROM restaurants r
        WHERE
          ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
          ${nameFilter}
          AND NOT EXISTS (SELECT 1 FROM posted p WHERE p.id = r.id)
        ORDER BY r.location <-> ${originPoint} LIMIT ${limit}
      ),
      base AS (
        SELECT id, 0 AS tier, post_count FROM posted
        UNION ALL
        -- 投稿ゼロの店。post_count = 0 の同着なので、最終 ORDER BY で «近い順» に並ぶ
        SELECT id, 1 AS tier, 0::int AS post_count FROM nearest
      ),
      candidates AS (
        -- 入札は並びに使わないが meta としては返す。候補が limit 件に決まったあとに集計する
        SELECT
          b.id,
          b.tier,
          b.post_count,
          COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
          MAX(rb.end_date) AS max_end_date
        FROM base b
        ${activeBidJoin}
        GROUP BY b.id, b.tier, b.post_count
      )`;
    const orderBy = orderByDistance
      ? // #1629 距離順も geography で測る。WHERE の ST_DWithin と同じ土俵にしておかないと、
        // 「絞り込みには入っているのに並び順だけ別の距離」という食い違いが起きうる
        Prisma.sql`ORDER BY ST_Distance(r.location, ${originPoint}) ASC`
      : // #1629 **投稿が多い順 → 同数なら中心から近い順。**
        // tier は «投稿がある店（0）/ 無い店（1）» で、post_count > 0 と post_count = 0 の
        // 境目と一致するので、並びの意味は «投稿数の降順» のままである
        // （tier を落とすと «投稿枠に入れなかった投稿ありの店» が 0 件扱いの店と
        //  混ざるが、その 2 つを区別できないと «同数なら近い順» が崩れる）。
        // 距離まで同着なら id で決める（同着で順序が不定にならないようにする）
        Prisma.sql`ORDER BY c.tier ASC, c.post_count DESC, ST_Distance(r.location, ${originPoint}) ASC, r.id ASC`;

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
      GROUP BY r.id, c.tier, c.post_count, c.total_cents, c.max_end_date
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
