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

/**
 * #1779 検索・保存一覧が読む店の形。**落とす列（image_url / plus_code）は読まない。**
 *
 * `PrismaRestaurants` は生成物なので、そのまま使うと «落とすと決めた列» を
 * SELECT し続けてしまう。ここで先に外し、列が実際に落ちても型が変わらないようにする。
 */
export type ReadableRestaurant = Omit<
  PrismaRestaurants,
  'image_url' | 'plus_code'
>;

export type RestaurantWithMeta = {
  restaurant: ReadableRestaurant;
  meta: {
    reviewCount: number;
    averageRating: number;
    totalCents: number;
    maxEndDate: string | null;
  };
};

export type SavedRestaurantWithMeta = {
  restaurant: ReadableRestaurant;
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

    // 半径はそのまま m で使う（ST_DWithin の geography 版は m を取る）
    const radiusInMeters = dto.radius;

    // 生 SQL で集計。Prisma のテンプレートタグにより ${} 内はバインドパラメータとして扱われる。
    // - reactions / dish_media / dishes を辿って「保存された dish_media の属するレストラン」を抽出
    // - 保存日時（reactions.created_at）の降順でソート
    // - 距離フィルタは ST_DWithin（geography）+ GIST 索引。詳細は candidates のコメント
    const rawResult = await this.prisma.prisma.$queryRaw<
      (Pick<
        PrismaRestaurants,
        | 'id'
        | 'google_place_id'
        | 'name'
        | 'name_language_code'
        | 'latitude'
        | 'longitude'
        | 'image_path'
        | 'address_components'
        | 'created_at'
        | 'source_seed_id'
        | 'source_names'
        | 'source_row_hash'
        | 'synced_at'
        | 'created_by_source'
        | 'address'
        | 'country_code'
        | 'subterritory_code'
      > & {
        review_count: number;
        average_rating: number;
        last_saved_at: Date | null;
      })[]
    >`
    WITH saved_restaurants AS (
      -- ユーザーが「保存」した dish_media 経由でレストランを特定する
      SELECT
        d.restaurant_id,
        -- 同じレストランが複数の dish_media 経由で保存されていても 1 行にまとめる
        MAX(rct.created_at) AS last_saved_at
      FROM reactions rct
      JOIN dish_media dm
        /*
          #1629 【計測】この ::uuid は «遅い原因ではない» ことを確認したうえで残している。

          reactions.target_id は TEXT なので join でキャストが要るが、**キャストしているのは
          reactions 側（外側）**なので、dish_media は主キー索引でそのまま引ける。
          400,000 店 / 60,000 投稿 / 60,154 リアクションの再現環境で EXPLAIN ANALYZE を
          取ったところ、この CTE 全体（154 行）で **3 ms**（Bitmap Index Scan on
          idx_reactions_profile_cursor → Index Scan using dish_media_pkey、loops=154）だった。

          ⚠️ 向きを逆にして dm.id::text = rct.target_id と書き直さないこと。
             そちらは dish_media 側の主キー索引が使えなくなり、本当に全走査になる。

          #1513 削除しても save の reaction は残る。ここで弾かないと
          実体の無い投稿だけを根拠に店舗が「保存済み」として出続ける
        */
        ON rct.target_id::uuid = dm.id AND dm.deleted_at IS NULL
      JOIN dishes d
        ON d.id = dm.dish_id
      WHERE
        rct.user_id     = ${userId}::uuid
        AND rct.action_type = 'save'
        AND rct.target_type = 'dish_media'
      GROUP BY d.restaurant_id
    ),
    candidates AS (
      /*
        #1629 【設計】**この経路の駆動表は «そのユーザーが保存した店» でなければならない。**

        ## 直前まで何が起きていたか（dev の実測。オーナーが実機で踏んだ）

        getMeSavedRestaurants が p50 8,319 ms / p95 47,353 ms かかり、クライアントの
        30 秒タイムアウトで中断していた。「ピンが出ない」の正体はこの中断である。
        半径 5km でも 8 秒かかり、**半径が大きいほど比例して遅くなる**。
        保存の総数は dev で 154 行しかないので、«保存の件数» では説明が付かない。

        ## 真因（再現環境で EXPLAIN ANALYZE を取って確定させた）

        旧実装は lat / lng / radius / user_id を params という CTE にまとめ、
        JOIN params p ON TRUE して ST_DWithin(..., p.radius_km * 1000) と書いていた。
        **半径が CTE の向こう側にあるとプランナから値が見えない**ため、
        GIST 索引の行数見積りが既定値へ落ちる。実測（restaurants 400,000 行）:

          Bitmap Index Scan on idx_restaurants_location
            (cost=0.00..4.84 rows=40) (actual rows=59,527)   ← 1,000 倍以上の過小見積り

        「restaurants を索引で引けば 40 行しか出ない」と誤認したプランナは、
        **restaurants を駆動表にして半径内の全店を取り出し、154 行の保存済みを
        Hash Join で突き合わせる**プランを選ぶ。走る行数は半径に比例する。

          半径 5,480m … 54,997 行を走査 /  95 ms
          半径 389,333m … 191,546 行 / 390 ms
          半径 1,500,000m … 380,000 行 / 540 ms
          （実 dev は行数も並列度も違うので、ここでの ms はあくまで «比» を見るためのもの）

        ## なぜ «params CTE を消すだけ» では足りないのか

        params を消して値を直接束縛すると、**その場では**正しいプラン（16 ms、半径に
        依らず一定）になる。ただし Prisma が投げるのは prepared statement なので、
        同じ文を繰り返し実行すると PostgreSQL は途中から **generic plan**（パラメータの
        値を見ないプラン）へ切り替わる。再現環境で plan_cache_mode = force_generic_plan
        にして測ると、params を消しただけの版は **396 ms の元の悪いプランへ戻った**。
        dev のログで «同じ半径なのに 44 ms と 24,564 ms が混在する» のはこの切り替わりで
        説明が付く。

        ## どう直したか

        **saved_restaurants（そのユーザーの保存＝ dev で 154 行）を外側に置き、
        LATERAL で 1 行ずつ restaurants を主キーで引いて半径を判定する。**
        LATERAL の内側は外側の行を参照するので、プランナは nested loop 以外を選べない。
        走る行数は «保存した店の数» で決まり、**半径には一切依存しない**。
        force_generic_plan でも 24 ms のままだった。

        ⚠️ LIMIT 1 を消さないこと。これが無いと PostgreSQL は LATERAL 副問い合わせを
           pull up して普通の join に均してしまい、上の悪いプランへ戻る余地が生まれる。
           r.id = sr.restaurant_id は主キー一致なので、LIMIT 1 は意味を変えない。

        ⚠️ 並び順は «保存日時の新しい順» であって距離順ではないので、KNN 演算子
           （location <-> 点）で «近い n 件» に切ることはできない（意味が変わる）。

        ⚠️ この SQL はテンプレートリテラルの中である。**コメントにバッククォートを書かないこと**
           （文字列がそこで閉じる。#1375 で実際に踏んだ）。

        ⚠️ geography の ST_DWithin は既定で回転楕円体で測るので、真球の haversine とは
           境界付近で 0.3% 程度ずれる（より正確になる方向）。
           restaurants.location は latitude / longitude（ともに NOT NULL）からの生成列なので
           NULL になり得ず、haversine 版から乗り換えても «消える店» は出ない。
      */
      SELECT
        hit.id,
        sr.last_saved_at
      FROM saved_restaurants sr
      JOIN LATERAL (
        SELECT r.id
        FROM restaurants r
        WHERE r.id = sr.restaurant_id
          AND ST_DWithin(
                r.location,
                ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography,
                ${radiusInMeters}::double precision
              )
        LIMIT 1
      ) hit ON TRUE
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
      r.image_path,
      r.address_components,
      r.created_at,
      -- #843 catalog 同期の metadata
      r.source_seed_id,
      r.source_names,
      r.source_row_hash,
      r.synced_at,
      -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
      r.created_by_source,
      r.address,
      r.country_code,
      r.subterritory_code,
      agg.review_count,
      agg.average_rating,
      c.last_saved_at
    FROM candidates c
    JOIN restaurants r
      ON r.id = c.id
    /*
      #1629 【設計】**レビュー集計も «候補 1 件ずつの LATERAL» で回す。**

      旧実装は LEFT JOIN dishes → LEFT JOIN dish_reviews → GROUP BY r.id だった。
      候補は 20 件しか無いのに、再現環境ではプランナが dish_reviews（150,000 行）を
      **Seq Scan して Hash Right Join** するプランを選び、それだけで 27 ms 使っていた。
      dish_reviews が育つほどこの取り分は伸びる。

      LATERAL の集計副問い合わせは pull up されないので、**必ず候補ごとの
      idx_dishes_restaurant → idx_dish_reviews_alive_dish の nested loop になる**。
      走る行数は候補（最大 limit 件）ぶんで固定される。

      集計は 1 行を必ず返すので ON TRUE で件数は変わらない
      （レビューが 0 件の店は review_count = 0 / average_rating = 0 になり、
      LEFT JOIN + GROUP BY だった旧実装と同じ値になる。再現環境で全 20 行一致を確認済み）。
    */
    JOIN LATERAL (
      SELECT
        COUNT(dr.id)::int                             AS review_count,
        COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
      FROM dishes d
      JOIN dish_reviews dr
        -- #1513 削除済みレビューを件数・平均に混ぜない
        ON dr.dish_id = d.id AND dr.deleted_at IS NULL
      WHERE d.restaurant_id = r.id
    ) agg ON TRUE
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
        image_path: row.image_path,
        address_components: row.address_components,
        created_at: row.created_at,
        source_seed_id: row.source_seed_id,
        source_names: row.source_names,
        source_row_hash: row.source_row_hash,
        synced_at: row.synced_at,
        created_by_source: row.created_by_source,
        address: row.address,
        country_code: row.country_code,
        subterritory_code: row.subterritory_code,
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
    // #1629 最終 SELECT に GROUP BY は無い（集計は LATERAL 側で閉じている）ので、
    // r の列から成る距離式はそのまま ORDER BY に書ける
    const orderByDistance = Boolean(escapedNameQuery || dto.orderByDistance);
    /*
      #1629 【設計】**LIMIT は «バインド値» ではなく «literal» で埋める。**

      LIMIT がバインド値だと、generic plan（値が見えない）ではプランナが件数を
      既定値で見積もる。近傍枠の KNN は «索引を何件ぶん舐めるか» が LIMIT で決まるので、
      見積りが大きく振れ、そのままプラン全体のコストが跳ね上がる。
      コストが jit_above_cost（既定 100,000）を超えると **毎回 JIT コンパイルが走り**、
      再現環境では実行 123 ms に対して **JIT だけで 525 ms** 乗っていた。

      literal にすると custom plan と generic plan が同じプラン・同じコストになり、
      再現環境の generic は 651 ms → 166 ms になった。

      ⚠️ literal にすると limit の値ごとに別の prepared statement になる。
         この API の limit は実質 20（クライアントの既定）に固定されているので実害は無い。
      ⚠️ SQL へ直接埋める値なので、**必ず整数へ丸めて範囲を締めてから** Prisma.raw に渡す。
         DTO 側は @Min(1) / @Max(100) だが @IsInt が無く、内部呼び出し
         （dish-media-imports）も同じ型を通るため、ここで最終的に潰しておく。
    */
    const requestedLimit = dto.limit ?? 20;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 20;
    const limitSql = Prisma.raw(String(limit));
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
    // 有効な入札（並びには使わないが meta として返す）の集計。
    // 候補が limit 件に確定したあとにしか使わない。
    // #1629 LEFT JOIN + GROUP BY ではなく LATERAL の集計にしてある。集計副問い合わせは
    // pull up されないので、**必ず候補 1 件ずつの idx_restaurant_bids_restaurant 探索**になり、
    // restaurant_bids が育っても走る行数は «候補の入札» ぶんで固定される。
    // 集計は GROUP BY 無しなので必ず 1 行返る（ON TRUE で件数は変わらない。
    // 入札ゼロの店は total_cents = 0 / max_end_date = NULL で、旧実装と同じ値になる）
    const activeBidJoin = Prisma.sql`
        JOIN LATERAL (
          SELECT
            COALESCE(SUM(rb.amount_cents), 0)::double precision AS total_cents,
            MAX(rb.end_date) AS max_end_date
          FROM restaurant_bids rb
          WHERE rb.restaurant_id = b.id
            AND rb.start_date <= CURRENT_DATE
            AND rb.end_date > CURRENT_DATE
            AND rb.status = 'paid'
        ) bid ON TRUE`;
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
        /*
          #1629 【設計】**距離順の枝も «KNN と ST_DWithin を同じ WHERE に並べない»。
          ただし «店名あり» と «店名なし» で正しい形が違うので、ここで分ける。**

          この枝も、直前まで近傍枠（nearest）とまったく同じ形で同じ穴があった。
          再現環境の実測（custom plan）:

            半径 20km    … restaurants から延べ 272,592 行 / 197 ms
            半径 1,500km … 延べ 566,380 行 / 653 ms

          住所照合（orderByDistance）は半径 1km 固定なので実害は出ていなかったが、
          **店名検索はクライアントの viewport 半径をそのまま受け取る**（#1629 で
          50km clamp を外した）ので、日本全体を映して店名を打つと踏む経路である。

          ## 店名あり … 駆動表は «店名» でなければならない

          店名は trgm 索引（idx_restaurants_name_trgm）で十分に絞れる。
          そこで **KNN 演算子を使わず ST_Distance で並べる**。KNN が無ければ
          «GIST を舐めて並べ替える» 経路自体が存在しないので、プランナは
          trgm で絞ってから小さな集合を並べ替えるしかない。
          再現環境（半径 1,500km・希少な店名）で Bitmap Index Scan on
          idx_restaurants_name_trgm → 8 ms。

          ⚠️ ここで «KNN + LIMIT を内側に閉じる» 形（nearest と同じ形）にしてはいけない。
             店名が希少だと «近い順に舐めて 20 件そろうまで» が全件走査になる。

          ## 店名なし … 近傍枠（nearest）と同じ形

          絞り込みが半径しか無いので、KNN を内側に閉じて半径を外側で掛ける。
          同値である理由と注意点は nearest 側のコメントに書いてある。
        */
        ${
          escapedNameQuery
            ? Prisma.sql`
        SELECT r.id
        FROM restaurants r
        WHERE
          r.name ILIKE ${'%' + escapedNameQuery + '%'}
          AND ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
        ORDER BY ST_Distance(r.location, ${originPoint}) ASC LIMIT ${limitSql}`
            : Prisma.sql`
        SELECT k.id
        FROM (
          SELECT r.id, r.location
          FROM restaurants r
          ORDER BY r.location <-> ${originPoint} LIMIT ${limitSql}
        ) k
        WHERE ST_DWithin(k.location, ${originPoint}, ${radiusInMeters})`
        }
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
          bid.total_cents,
          bid.max_end_date
        FROM base b
        ${activeBidJoin}
      )`
      : Prisma.sql`
      post_counts AS MATERIALIZED (
        /*
          #1629 【設計】**投稿数の集計は «restaurants と混ぜずに» 1 回で終わらせる。**

          最初の実装は dish_media / dishes / restaurants を 1 つの WHERE に混ぜ、
          そこへ半径（ST_DWithin）まで入れていた。全国規模の半径では restaurants の
          ほぼ全件が条件を満たすため、プランナは «restaurants → dishes → dish_media» の
          順に nested loop を選び、**dish_media を店舗ごとに Seq Scan** した。

          dev 実測（run 33172881100・EXPLAIN ANALYZE）:
            Seq Scan on dish_media (rows=4896, loops=2357)  = 延べ 1,150 万行
            日本全体 225 ms → **3,478 ms** / 50km 107 ms → **2,188 ms**
          並びを変えただけで 15〜20 倍遅くなっていた。

          そこで «店ごとの投稿数» だけを先に 1 回で作る。MATERIALIZED を付けるのは、
          外して inline されると上と同じ nested loop へ戻るためである（Postgres 12 以降、
          CTE は既定で inline されうる）。**この 2 語を消さないこと。**

          ⚠️ ここは dish_media の全行を 1 回走る。いまは 4,896 行なので安いが、
             投稿が数百万行に育ったら restaurants への非正規化列
             （post_count + btree）か集計済みビューが要る。
        */
        SELECT d.restaurant_id AS id, COUNT(*)::int AS post_count
        FROM dish_media dm
        JOIN dishes d ON d.id = dm.dish_id
        -- #1513 削除済みの投稿は数えない
        WHERE dm.deleted_at IS NULL
        GROUP BY d.restaurant_id
      ),
      posted AS (
        /*
          #1629 【設計】**投稿枠の駆動表は «投稿を持つ店（post_counts）» でなければならない。
          restaurants 側を先に半径で絞らせてはいけない。**

          ## 何が起きていたか（オーナーが実機で踏んだ回帰）

          «投稿が多い順» を入れた commit 3dfd061d のあと、dev の
          GET /v1/restaurants/search（東京駅・半径 20,000m・limit 20）が
          **7,625 / 16,222 / 25,954 ms** かかった（queue_ms は 1〜2 ms なので接続待ちではない）。
          ところが同じ SQL を literal 埋め込みで EXPLAIN ANALYZE すると 46〜270 ms で速い。
          **測り方が実運用と違っていた**のが «速く見えていた» 理由である。

          ## 真因（force_generic_plan で再現させて確定させた）

          この CTE は「post_counts と restaurants を普通に join し、restaurants 側へ
          ST_DWithin を掛ける」形だった。半径がバインドパラメータなので、
          **generic plan ではプランナに半径の値が見えない**。GIST 索引の行数見積りは
          既定値（rows=57）へ落ち、「restaurants を索引で引けば数十行」と誤認する。
          その結果 **restaurants を build 側にした Hash Join**（= 半径内の全店を読む）を選ぶ。

          再現環境（restaurants 570,000 行 / 投稿を持つ店 7,990 / limit 20）の実測:

            旧: 半径 20km   … restaurants から延べ 117,935 行  / generic 425 ms
                半径 1,500km … 延べ **558,060 行**（ほぼ全店） / generic 1,897 ms
            新: 半径 20km   … 延べ 60 行                      / generic 116 ms
                半径 1,500km … 延べ 8,050 行（= 投稿を持つ店） / generic 124 ms

          走る行数が半径に比例するのが旧、半径に依存しないのが新である。dev の
          restaurants は 1 行が address_components（JSONB）ぶん太いので、
          この «半径内の全店を読む» が remote storage 上では秒単位になる。
          同じ半径で 7.6 秒と 26 秒が混在するのは、custom plan と generic plan が
          切り替わる（＋ページがキャッシュに載っているか）ためである。

          ## どう直したか

          **post_counts（投稿を持つ店だけの小さな集合）を外側に置き、
          LATERAL で 1 行ずつ restaurants を主キーで引いて半径を判定する。**
          searchNearbySavedRestaurants（#1682）と同じ構えである。
          LATERAL の内側は外側の行を参照するので、プランナは nested loop 以外を選べない。

          ⚠️ この SQL のコメントに **半角の疑問符**を書かないこと。Prisma.Sql#sql は
             バインド位置を半角疑問符で表現するため、コメントの中に混ざると
             ダンプした SQL からプレースホルダを数える側が位置をずらす
             （scripts/db-checks/measure_order_by_posts.py が実際にずれた）。
             restaurants.order-by-posts-plan.spec.ts が個数一致を機械検査している。

          ⚠️ LIMIT 1 を消さないこと。これが無いと副問い合わせが pull up されて
             普通の join に均され、上の悪いプランへ戻る余地が生まれる。
             r.id = pc.id は主キー一致なので、LIMIT 1 は意味を変えない。

          ⚠️ 並び（投稿が多い順 → 同数なら中心から近い順）も、返る行も、
             書き換えの前後で完全に同一であることを再現環境で確認済み
             （半径 20km / 1,500km の両方で 20 行が完全一致）。
        */
        SELECT
          pc.id,
          pc.post_count,
          hit.distance_m
        FROM post_counts pc
        JOIN LATERAL (
          SELECT ST_Distance(r.location, ${originPoint}) AS distance_m
          FROM restaurants r
          WHERE r.id = pc.id
            AND ST_DWithin(r.location, ${originPoint}, ${radiusInMeters})
            ${nameFilter}
          LIMIT 1
        ) hit ON TRUE
        -- 同数なら中心から近い順。«どの limit 件を残すか» を最終 ORDER BY と一致させる
        ORDER BY pc.post_count DESC, hit.distance_m ASC LIMIT ${limitSql}
      ),
      nearest AS (
        /*
          #1629 【設計】**近傍枠は «KNN を内側に閉じ、半径は外側で掛ける»。
          KNN と ST_DWithin を同じ WHERE に並べてはいけない。**

          投稿枠で埋まらない残りを «中心から近い順» で埋める枠である。
          ここが «引くと 0 件» を構造的に消している（半径内に投稿が 1 件も無くても埋まる）。

          ## 何が起きていたか（#1686 のあと dev に残っていた回帰）

          #1686 で generic plan は直ったが、**custom plan が 11〜13 秒のまま**だった
          （dev 実測 run 33229509189。東京駅 20km で 11,498 ms / 日本全体で 12,893 ms、
          いずれも restaurants から 15 万〜57 万行を読んでいた）。
          50km だけ 35 ms と速く、**半径に対して単調ですらなかった**。

          ## 真因（再現環境で dev と同じプランを出して確定させた）

          旧実装は同じ WHERE に ST_DWithin と KNN（ORDER BY location <-> 点）を並べていた。
          この形はひとつの GIST 索引に対して **2 通りの経路**を許す:

            (a) KNN 索引スキャンを近い順に舐めて LIMIT 件で打ち切る（速い。行数は LIMIT で一定）
            (b) ST_DWithin で Bitmap 索引スキャンし、**半径内を全部**取ってから並べ替える（遅い）

          プランナは (b) を選びうる。理由は見積りにある。ST_DWithin をフィルタとして見たときの
          行数見積りは PostGIS の既定へ落ちて **LIMIT より小さい**（dev では rows=18 < 20）。
          «20 件そろえるには索引を最後まで舐めることになる» と誤認するので (a) が極端に高く
          値付けされ、(b) が勝つ。半径の «値» が見えている custom plan でのみ起きるので、
          **generic だけ速く custom だけ遅い**という倒錯した形になっていた。

          再現環境（restaurants 570,000 行 / max_parallel_workers_per_gather=4 /
          random_page_cost=1.1 ＝ dev と同じプランが出る設定）での実測:

            旧 custom 20km   … Parallel Bitmap Heap Scan + Sort。延べ 272,612 行 / 1,028 ms
            旧 custom 1,500km … 延べ 574,385 行 / 1,822 ms
            新 custom 20km   … KNN 索引スキャン。延べ 60 行 / 12 ms

          ## どう直したか

          **内側の副問い合わせには KNN と LIMIT だけを置き、ST_DWithin を外側へ出す。**
          内側に location の絞り込みが無いので (b) の経路は存在せず、
          プランナは KNN 索引スキャン以外を選べない。LIMIT 20 を取り出すコストは
          «索引を最後まで舐める» ではなく «20 件ぶん» に値付けされる（実測でコスト
          605,506 → 17.78）。custom / generic のどちらでも同じ速いプランになる。

          ## 半径の外を返さないこと・0 件にしないことは壊れていない

          «距離順に並べて上位 n 件を取り、あとから半径で切る» のは、
          «先に半径で切ってから距離順に上位 n 件を取る» と **完全に同値**である。
          半径で落ちる行は残る行より必ず遠いので、順位が入れ替わることがない
          （距離のしきい値は距離順に対して prefix-closed）。したがって:
            - 半径の外の店が混ざることはない（外側で必ず切っている）
            - 半径内に店があるのに 0 件になることもない
          再現環境の半径 1km / 20km / 50km / 1,500km で、返る行が旧実装と完全一致することを確認済み。

          ⚠️ 内側の LIMIT を消さないこと。PostgreSQL は LIMIT 付き副問い合わせへ
             外側の条件を押し込まないので、この LIMIT が «ST_DWithin が内側へ戻る» のを
             止めている。消すと (b) の経路が復活する。

          ⚠️ ST_DWithin を内側に «念のため» 併記しないこと。それが (b) を生む条件そのものである。

          ⚠️ geography の <-> は球、ST_DWithin は既定で回転楕円体で測るので、
             両者は 0.3% 程度ずれる。**ちょうど半径の境目にある店が、ちょうど limit 番目に
             来た**ときだけ 1 件多い / 少ないが起こりうる。旧実装も同じ 2 つを併用していたので
             ずれの大きさは変わらない。
        */
        SELECT k.id
        FROM (
          SELECT r.id, r.location
          FROM restaurants r
          -- ⚠️ ここには **location の条件も、posted との突き合わせも置かない**。
          --    どちらも «KNN 索引スキャン以外の経路» をプランナへ与えてしまう
          --    （ST_DWithin は Bitmap 経路を、NOT EXISTS は Hash Anti Join + Seq Scan を生む。
          --     後者は実測で restaurants 570,000 行の Seq Scan になった）。
          --    この枝で nameFilter は常に空である（店名検索は orderByDistance へ回る）。
          --    それでも書いてあるのは、将来この枝へ店名検索を回したときに
          --    «絞り忘れで誤った結果を返す» ことがないようにするためである
          ${nameFilter}
          ORDER BY r.location <-> ${originPoint} LIMIT ${limitSql}
        ) k
        WHERE ST_DWithin(k.location, ${originPoint}, ${radiusInMeters})
      ),
      base AS (
        SELECT id, 0 AS tier, post_count FROM posted
        UNION ALL
        /*
          投稿ゼロの店。post_count = 0 の同着なので、最終 ORDER BY で «近い順» に並ぶ。

          #1629 【設計】**投稿枠との重複除去はここで行う。近傍枠の中へ入れない。**
          NOT EXISTS を KNN の副問い合わせの中に置くと、プランナが
          Hash Anti Join + restaurants の Seq Scan（570,000 行）を選んでしまい、
          KNN 索引スキャンが使われなくなる（再現環境で実測。1,432 ms）。
          ここへ出せば突き合わせる相手は高々 limit 件どうしなので、ただの小さな集合演算になる。

          ⚠️ 件数は減らない。近傍枠は «半径内で近い順に limit 件»、投稿枠は高々 limit 件で、
             重なるのは高々 «投稿枠の件数 p» 件である。よって
             重複除去後の近傍枠は (limit - p) 件以上残り、
             投稿枠 p 件と合わせて必ず limit 件に届く（半径内の総数が limit 未満のときは
             その総数。これは旧実装と同じ）。
        */
        SELECT n.id, 1 AS tier, 0::int AS post_count
        FROM nearest n
        WHERE NOT EXISTS (SELECT 1 FROM posted p WHERE p.id = n.id)
      ),
      candidates AS (
        -- 入札は並びに使わないが meta としては返す。候補が limit 件に決まったあとに集計する
        SELECT
          b.id,
          b.tier,
          b.post_count,
          bid.total_cents,
          bid.max_end_date
        FROM base b
        ${activeBidJoin}
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
        | 'image_path'
        | 'address_components'
        | 'created_at'
        | 'source_seed_id'
        | 'source_names'
        | 'source_row_hash'
        | 'synced_at'
        | 'created_by_source'
        | 'address'
        | 'country_code'
        | 'subterritory_code'
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
          r.image_path,
        r.address_components,
          r.created_at,
        -- #843 catalog 同期の metadata
        r.source_seed_id,
        r.source_names,
        r.source_row_hash,
        r.synced_at,
        -- #843 その行を誰が作ったか。9_1 の同期はこの値が 'pipeline' の行だけを上書きする
        r.created_by_source,
        r.address,
        r.country_code,
        r.subterritory_code,
        c.total_cents,
        c.max_end_date,
        agg.review_count,
        agg.average_rating
      FROM candidates c
      JOIN restaurants r
        ON r.id = c.id
      /*
        #1629 【設計】**レビュー集計も «候補 1 件ずつの LATERAL» で回す。**

        旧実装は LEFT JOIN dishes → LEFT JOIN dish_reviews → GROUP BY r.id だった。
        候補は limit 件しか無いのに、プランナが dish_reviews を Seq Scan して
        Hash Right Join するプランを選びうる（searchNearbySavedRestaurants で
        実際に踏み、それだけで 27 ms 使っていた。#1682）。dish_reviews が育つほど伸びる。

        LATERAL の集計副問い合わせは pull up されないので、**必ず候補ごとの
        idx_dishes_restaurant → idx_dish_reviews_alive_dish の nested loop になる**。

        集計は GROUP BY 無しなので必ず 1 行返る（ON TRUE で件数は変わらない。
        レビュー 0 件の店は review_count = 0 / average_rating = 0 になり、
        LEFT JOIN + GROUP BY だった旧実装と同じ値になる）。
      */
      JOIN LATERAL (
        SELECT
          COUNT(dr.id)::int                             AS review_count,
          COALESCE(AVG(dr.rating), 0)::double precision AS average_rating
        FROM dishes d
        JOIN dish_reviews dr
          -- #1513 削除済みレビューを件数・平均に混ぜない
          ON dr.dish_id = d.id AND dr.deleted_at IS NULL
        WHERE d.restaurant_id = r.id
      ) agg ON TRUE
      ${orderBy}
      LIMIT ${limitSql};
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

  /**
   * #1671 【設計】**空いている住所・国コードだけを埋める。既にある値は上書きしない。**
   *
   * ⚠️ **«62 万行が空» は事実ではなかった**（2026-09-05 実測 / #1846 のついでに計測）。
   *    dev の 621,974 店のうち `address` は 620,300 店（99.73%）、`country_code` は
   *    621,964 店（100.00%）が既に埋まっている。空いているのは address が 1,674 行
   *    （0.27%）、country_code が 10 行だけである。**この関数はほぼ no-op である。**
   *    害は無い（空きしか埋めない）が、«62 万行のための機能» ではない。
   *
   * もともとの想定は «パイプライン製の行は address / country_code が空で、ユーザーが
   * POI を押しても «既存店だからそのまま開く» 経路に入るため**永久に埋まらなかった**。
   * 確認ページを通ったときだけ、ユーザーが確認した値でその穴を塞ぐ。
   *
   * ⚠️ **上書きはしない。** 既に誰かが確認して入れた値を、後から来た別のユーザーの
   * 確認で書き換えると «最後に触った人が勝つ» になる。埋まっているものは触らない。
   * （競合の解決を入れるなら #1827 の結論を待つ）
   *
   * ⚠️ 判定は **SQL の WHERE でやる**。読んでから TS で分岐して書くと、
   * 同じ店を 2 人が同時に確認したときに後勝ちが起きる。
   *
   * @returns 実際に埋めた行数（0 なら既に埋まっていた）
   */
  async fillMissingAddress(
    tx: Prisma.TransactionClient,
    params: {
      restaurantId: string;
      address: string;
      countryCode: string | null;
      subterritoryCode: string | null;
    },
  ): Promise<number> {
    const { restaurantId, address, countryCode, subterritoryCode } = params;

    /*
      #1671 【設計】**列ごとに «空いているものだけ» を埋める。**

      ⚠️ 以前はここが `updateMany` で、WHERE に «どれか 1 つでも空なら» を書き、
      SET では `address` を **無条件に**書いていた。そのため

          address = '既に確認済みの住所' / country_code = NULL

      の行が WHERE に引っかかり、**埋まっていた住所を上書きしていた**。
      「埋まっているものは触らない」と書いてあるのに、そうなっていなかった。

      Prisma の updateMany は «列ごとに条件を変える» を書けないので、生 SQL にする。
      `COALESCE(NULLIF(col, ''), $新しい値)` なら、空（NULL または空文字）のときだけ
      新しい値が入り、埋まっている列はそのままの値で上書きされる（＝実質そのまま）。

      ⚠️ 判定は SQL の中に閉じること。読んでから TS で分岐して書くと、
      同じ店を 2 人が同時に確認したときに後勝ちが起きる。
    */
    return tx.$executeRaw(Prisma.sql`
      UPDATE restaurants
      SET
        address           = COALESCE(NULLIF(address, ''), ${address}),
        country_code      = COALESCE(NULLIF(country_code, ''), ${countryCode}),
        subterritory_code = COALESCE(NULLIF(subterritory_code, ''), ${subterritoryCode})
      WHERE id = ${restaurantId}::uuid
        AND (
             NULLIF(address, '') IS NULL
          OR NULLIF(country_code, '') IS NULL
          OR NULLIF(subterritory_code, '') IS NULL
        )
    `);
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
