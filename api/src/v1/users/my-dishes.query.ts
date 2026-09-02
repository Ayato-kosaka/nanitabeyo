// api/src/v1/users/my-dishes.query.ts
//
// #1395 GET /v1/users/me/dishes・/map-pins が共有する
// 「keyset カーソルの符号化」と「keyset 述語 / 並び順の組み立て」。
//
// SQL 本体（users.repository.ts）から切り出しているのは、ここが本 Issue の
// Blocker 2 件（B-1: -rating の keyset / B-2: LIMIT の枝内押し込み）の核であり、
// DB 無しで単体テストできるようにしておきたいためである。

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import type {
  MyDishSort,
  MyDishStatus,
  QueryMyDishesDto,
} from '@shared/v1/dto';
import { parseMyDishFeatureKey } from '@shared/v1/dto';
import { MY_DISH_MAP_PINS_LIMIT } from '@shared/v1/res';

/**
 * 候補行（UNION ALL の各枝）が公開する列名。
 *
 * 枝の中身は `SELECT ... FROM ...` を素の副問い合わせで包み、
 * keyset 述語と ORDER BY は**この別名**に対して書く。
 * こうすると 2 枝で述語を共有でき、Postgres は副問い合わせを平坦化するので
 * 索引による早期打ち切りも保たれる。
 */
export const MY_DISH_ROW_COLUMNS = {
  key: 'row_key',
  status: 'row_status',
  occurredAt: 'occurred_at',
  rating: 'rating',
  distance: 'distance_meters',
  featureScore: 'feature_score',
} as const;

/** keyset カーソルの復元結果。sort ごとに構成要素が違う */
export type MyDishCursor =
  | { sort: '-occurredAt' | 'occurredAt'; occurredAt: Date; key: string }
  | {
      sort: '-rating';
      /**
       * #1395 B-1: **NULL 判定を第1ソートキーへ持ち上げる**。
       * `NULLS LAST` を書くだけでは 2 ページ目以降で want 行が全部消える
       * （`(rating, ...) < ($r, ...)` が rating IS NULL の行に対して unknown を返し、
       * WHERE が unknown を偽として扱うため）。
       */
      ratingIsNull: boolean;
      rating: number | null;
      occurredAt: Date;
      key: string;
    }
  | { sort: 'distance'; distanceMeters: number; key: string }
  | {
      sort: '-featureScore';
      score: number;
      occurredAt: Date;
      key: string;
    };

/** カーソルの区切り文字。`row_key`（`review:<uuid>` / `dish:<uuid>`）にも ISO8601 にも現れない */
const SEP = '|';

/** カーソル生成に必要な行の情報（SQL の返り値の部分集合） */
export type MyDishCursorSource = {
  row_key: string;
  occurred_at: Date;
  rating: number | null;
  distance_meters: number | null;
  feature_score: number | null;
};

/**
 * 次ページ用カーソルを組み立てる。
 *
 * ⚠️ テンプレートリテラルで `null` を文字列化しないこと（`"null"` になり `Number("null")` が NaN になる）。
 * NULL は**空文字 + 別立ての NULL フラグ**で表す。
 */
export function encodeMyDishCursor(
  sort: MyDishSort,
  row: MyDishCursorSource,
): string {
  const iso = row.occurred_at.toISOString();
  switch (sort) {
    case '-occurredAt':
    case 'occurredAt':
      return [iso, row.row_key].join(SEP);
    case '-rating':
      return [
        row.rating === null ? '1' : '0',
        row.rating === null ? '' : String(row.rating),
        iso,
        row.row_key,
      ].join(SEP);
    case 'distance':
      if (row.distance_meters === null) {
        // distance ソートは lat/lng 必須なのでここには来ない。来たら契約違反なので落とす
        throw new Error('distance sort produced a row without distance_meters');
      }
      return [String(row.distance_meters), row.row_key].join(SEP);
    case '-featureScore':
      return [String(row.feature_score ?? 0), iso, row.row_key].join(SEP);
  }
}

function invalidCursor(): never {
  throw new BadRequestException('Invalid cursor');
}

function parseIsoDate(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) invalidCursor();
  return d;
}

function parseFiniteNumber(raw: string): number {
  if (raw.trim() === '') invalidCursor();
  const n = Number(raw);
  if (!Number.isFinite(n)) invalidCursor();
  return n;
}

/**
 * カーソルを復元する。壊れていたら **400 で落とす**。
 * 黙って無視すると同じページを 2 回返してしまい、無限スクロールが重複する。
 */
export function decodeMyDishCursor(
  sort: MyDishSort,
  raw: string,
): MyDishCursor {
  const parts = raw.split(SEP);
  switch (sort) {
    case '-occurredAt':
    case 'occurredAt': {
      if (parts.length !== 2 || !parts[1]) invalidCursor();
      return { sort, occurredAt: parseIsoDate(parts[0]), key: parts[1] };
    }
    case '-rating': {
      if (parts.length !== 4 || !parts[3]) invalidCursor();
      const [flag, ratingRaw, isoRaw, key] = parts;
      if (flag !== '0' && flag !== '1') invalidCursor();
      const ratingIsNull = flag === '1';
      if (ratingIsNull && ratingRaw !== '') invalidCursor();
      if (!ratingIsNull && ratingRaw === '') invalidCursor();
      return {
        sort,
        ratingIsNull,
        rating: ratingIsNull ? null : parseFiniteNumber(ratingRaw),
        occurredAt: parseIsoDate(isoRaw),
        key,
      };
    }
    case 'distance': {
      if (parts.length !== 2 || !parts[1]) invalidCursor();
      return {
        sort,
        distanceMeters: parseFiniteNumber(parts[0]),
        key: parts[1],
      };
    }
    case '-featureScore': {
      if (parts.length !== 3 || !parts[2]) invalidCursor();
      return {
        sort,
        score: parseFiniteNumber(parts[0]),
        occurredAt: parseIsoDate(parts[1]),
        key: parts[2],
      };
    }
  }
}

/**
 * 並び順。UNION ALL の各枝の中でも、マージ後の外側でも**同じ式**を使う。
 *
 * `-rating` は `(rating IS NULL) ASC` を第1キーに置く。これにより
 * - 評価なし（= want）の行が★5より上に来ることがなくなり（Postgres の `DESC` 既定は `NULLS FIRST`）、
 * - **want 行は常に末尾**という仕様が表現できる。
 */
export function buildMyDishOrderBy(sort: MyDishSort): Prisma.Sql {
  switch (sort) {
    case '-occurredAt':
      return Prisma.sql`occurred_at DESC, row_key DESC`;
    case 'occurredAt':
      return Prisma.sql`occurred_at ASC, row_key ASC`;
    case '-rating':
      return Prisma.sql`(rating IS NULL) ASC, rating DESC, occurred_at DESC, row_key DESC`;
    case 'distance':
      return Prisma.sql`distance_meters ASC, row_key ASC`;
    case '-featureScore':
      return Prisma.sql`feature_score DESC, occurred_at DESC, row_key DESC`;
  }
}

/**
 * keyset 述語。カーソルが無ければ `TRUE`。
 *
 * **2 枝（want / eaten）で同じ述語を使う。** 枝ごとに書き分けないのは、
 * 書き分けた瞬間に「want 側で rating を落とす」類の取りこぼしが混入するためである。
 */
export function buildMyDishKeysetPredicate(
  cursor: MyDishCursor | null,
): Prisma.Sql {
  if (!cursor) return Prisma.sql`TRUE`;

  switch (cursor.sort) {
    case '-occurredAt':
      return Prisma.sql`(occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)`;
    case 'occurredAt':
      return Prisma.sql`(occurred_at, row_key) > (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)`;
    case '-rating': {
      const cn = cursor.ratingIsNull ? 1 : 0;
      // n = 「評価が無い行か」の 0/1。並びは n ASC, rating DESC, occurred_at DESC, row_key DESC。
      //
      // - n > cn                       … 評価ありの区画を抜けて評価なし（want）区画へ入る
      // - n = cn かつ cn = 1           … want 区画の中。rating は全て NULL なので日時と key だけで進む
      // - n = cn かつ cn = 0           … eaten 区画の中。rating → 日時 → key の順で進む
      //
      // cn = 1 のとき ${cursor.rating} は NULL になるが、その枝は `1 = 0` で
      // 常に偽になる conjunct の中にあるため評価結果に影響しない（false AND NULL = false）。
      return Prisma.sql`(
        ((rating IS NULL)::int) > ${cn}::int
        OR (
          ((rating IS NULL)::int) = ${cn}::int
          AND ${cn}::int = 1
          AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
        )
        OR (
          ((rating IS NULL)::int) = ${cn}::int
          AND ${cn}::int = 0
          AND (
            rating < ${cursor.rating}::int
            OR (
              rating = ${cursor.rating}::int
              AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
            )
          )
        )
      )`;
    }
    case 'distance':
      return Prisma.sql`(distance_meters, row_key) > (${cursor.distanceMeters}::double precision, ${cursor.key}::text)`;
    case '-featureScore':
      return Prisma.sql`(
        feature_score < ${cursor.score}::double precision
        OR (
          feature_score = ${cursor.score}::double precision
          AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
        )
      )`;
  }
}

/**
 * この枝はカーソルより後ろの行を 1 件も持ち得ないか（= 枝ごと省略できるか）。
 *
 * `buildMyDishKeysetPredicate` だけでも結果は正しいが、`-rating` で
 * カーソルが want 区画に入った後は eaten 枝を投げても必ず 0 件なので、
 * `dish_reviews`（約 964MB）への問い合わせを 1 本まるごと省ける。
 *
 * ⚠️ **want 枝を省略できるケースは無い。**
 * `-rating` のカーソルが eaten 区画にあっても、want 行はまだ 1 件も返していない。
 * ここを「rating が無いから落とす」と書いた瞬間に B-1 の事故が再発する。
 */
export function isBranchSkippableByCursor(
  branch: 'want' | 'eaten',
  cursor: MyDishCursor | null,
): boolean {
  if (!cursor) return false;
  if (cursor.sort !== '-rating') return false;
  return branch === 'eaten' && cursor.ratingIsNull;
}

/**
 * 評価フィルタが指定されているか。
 *
 * #1395 m-4: want 行は評価を持たないため、評価フィルタが 1 つでも付いた瞬間に
 * want 行は 1 件も残らない。サーバ側は want 枝を評価せず eaten だけを返し、
 * クライアントは `status` に want を含む間、評価フィルタを不活性にすること。
 */
export function hasRatingFilter(dto: {
  minRating?: number;
  ratings?: number[];
}): boolean {
  return dto.minRating !== undefined || (dto.ratings?.length ?? 0) > 0;
}

/**
 * #1395 Calendar 用 `meta.oldestOccurredAt` を算出してよいか（`status` 以外のフィルタが無いか）。
 *
 * status 以外のフィルタが 1 つでもあると索引で順序を保てず、`dish_reviews`
 * （約 964MB）に対するユーザー全行走査になる（B-2）。それが**フィルタを変えるたび**に
 * 走ってしまうため、フィルタが付いているときは算出しない。
 *
 * #1397: `restaurantId` もここでいう「フィルタ」に数える。取りこぼすと、
 * Map のピン → Sheet を開くたびに B-2 の全行走査が走ってしまう。
 */
export function hasMyDishesFilterBeyondStatus(dto: {
  lat?: number;
  lng?: number;
  radius?: number;
  categoryIds?: string[];
  minRating?: number;
  ratings?: number[];
  from?: string;
  to?: string;
  restaurantId?: string;
}): boolean {
  return (
    dto.lat !== undefined ||
    dto.lng !== undefined ||
    dto.radius !== undefined ||
    (dto.categoryIds?.length ?? 0) > 0 ||
    dto.minRating !== undefined ||
    (dto.ratings?.length ?? 0) > 0 ||
    dto.from !== undefined ||
    dto.to !== undefined ||
    dto.restaurantId !== undefined
  );
}

/** レストランの列を SELECT に展開する（生 SQL を 2 本で共有する） */
export const RESTAURANT_COLUMNS_SQL = Prisma.sql`
  r.id                 AS r_id,
  r.google_place_id    AS r_google_place_id,
  r.name               AS r_name,
  r.name_language_code AS r_name_language_code,
  r.latitude           AS r_latitude,
  r.longitude          AS r_longitude,
  r.image_url          AS r_image_url,
  r.image_path         AS r_image_path,
  r.address_components AS r_address_components,
  r.plus_code          AS r_plus_code,
  r.created_at         AS r_created_at`;

/**
 * 一覧と Map ピンが**共有する**候補行 SQL を組み立てる。
 *
 * 返すのは
 * - `ctes`      : `my_save_ids` / `my_saved_dishes`（WITH 句へそのまま差し込む）
 * - `candidates`: `(want 枝) UNION ALL (eaten 枝)`
 * の 2 つ。フィルタ条件がここ 1 箇所に集まるので、2 エンドポイントで重複実装にならない。
 *
 * ## 設計上の要点
 *
 * **(1) `reactions.target_id::uuid` は MATERIALIZED フェンスの内側でだけキャストする（M-1）**
 * `dish_categories.id` は TEXT（Wikidata QID）で、`reactions.target_id` には
 * `Q1338822` のような **`::uuid` にすると必ず落ちる値が実在する**。
 * `target_type='dish_media'` を先に適用してくれることをプランナに期待するのではなく、
 * `MATERIALIZED` で最適化フェンスを張り、**構造的に**非 UUID がキャストへ届かないようにする。
 * `idx_reactions_profile_cursor (user_id, target_type, action_type, created_at DESC, id)` が
 * そのまま効く。
 *
 * **(2) カーソル・from/to・LIMIT を UNION ALL の各枝の内側へ押し込む（B-2）**
 * CTE を複数回参照すると PostgreSQL 12+ でも materialize されるため、
 * 1 ページ取るたびにユーザーの `dish_reviews` 全行（約 964MB のテーブル）を読むことになる。
 * 各枝を keyset 順に並べて `LIMIT $limit+1` し、マージ後にもう一度 limit する。
 *
 * **(3) want 行の除外は CTE ではなく `dish_reviews` の実体に対する `NOT EXISTS`（B-2）**
 * `idx_dish_reviews_user_dish (user_id, dish_id)`（20260819T0400）を使う。
 *
 * **(4) ブロックは効かせない（m-6）**
 * `reactions(action_type='block')` は「勧めてくるな」であって「自分の記録を消せ」ではないので、
 * 推薦クエリの `blocked_categories` CTE をここへコピーしない。
 *
 * **(5) want 枝も `reactions` 実体の側で削る（M-a）**
 * `my_save_ids` は `MATERIALIZED` なので、絞り込みを外側に置くと
 * **毎ページ save 全件の読み出しと `DISTINCT ON` のソート**が走る。
 * `from`/`to` と（押し込める向きの）カーソルを `my_save_ids` の内側へ移し、
 * `idx_reactions_profile_cursor (user_id, target_type, action_type, created_at DESC, id)` に
 * 範囲を食わせる。want 枝を組まないときは **CTE 自体を出力しない**（`ctes === null`）。
 */
export function buildMyDishesCandidates(
  userId: string,
  dto: QueryMyDishesDto,
  options: { cursor: MyDishCursor | null; branchLimit: number | null },
): { ctes: Prisma.Sql | null; candidates: Prisma.Sql } | null {
  const sort: MyDishSort = dto.sort ?? '-occurredAt';
  const statuses: MyDishStatus[] = dto.status?.length
    ? dto.status
    : ['want', 'eaten'];

  // #1395 m-4: 評価フィルタは want 行を必ず全消しする（want は rating を持たない）。
  // 無駄に枝を投げないよう、サーバ側でも want 枝を落とす。
  const ratingFilterActive = hasRatingFilter(dto);

  const includeWant =
    statuses.includes('want') &&
    !ratingFilterActive &&
    !isBranchSkippableByCursor('want', options.cursor);
  const includeEaten =
    statuses.includes('eaten') &&
    !isBranchSkippableByCursor('eaten', options.cursor);

  if (!includeWant && !includeEaten) return null;

  const hasArea =
    dto.lat !== undefined && dto.lng !== undefined && dto.radius !== undefined;

  // エリア絞り込みは ST_DWithin + 既存の GIST 索引（idx_restaurants_location）を使う。
  // 既存 searchNearbySavedRestaurants のバウンディングボックス + acos は
  // restaurants.latitude / longitude に btree が無く索引を活かせていないため踏襲しない。
  const areaFilter = hasArea
    ? Prisma.sql`AND ST_DWithin(r.location, ST_MakePoint(${dto.lng}::double precision, ${dto.lat}::double precision)::geography, ${dto.radius}::double precision)`
    : Prisma.empty;
  const distanceExpr = hasArea
    ? Prisma.sql`ST_Distance(r.location, ST_MakePoint(${dto.lng}::double precision, ${dto.lat}::double precision)::geography)::double precision`
    : Prisma.sql`NULL::double precision`;

  const categoryFilter = dto.categoryIds?.length
    ? Prisma.sql`AND d.category_id = ANY(${dto.categoryIds}::text[])`
    : Prisma.empty;

  // #1397: 店舗フィルタ（Map ピン → Sheet 専用）。
  // eaten 枝は categoryFilter と同じ位置（枝の内側）へ置く。
  // want 枝は `my_saved_dishes` CTE の JOIN dishes 側（下の restaurantJoin）へ押し込むので、
  // ここは eaten 枝専用。
  const restaurantFilter = dto.restaurantId
    ? Prisma.sql`AND d.restaurant_id = ${dto.restaurantId}::uuid`
    : Prisma.empty;

  // #1375 追補「時間帯・シチュエーションは絞り込みではなく並び替え」。
  // 既存 dish-categories.repository.ts と同じく dish_category_features を
  // LEFT JOIN して COALESCE(score, 0) を使う（新しいスコアリングを作らない）。
  //
  // #1375 実機確認: 軸を複数選べるようにした（時間帯 × 誰と行く × 価格帯 × …）。
  // sort は 1 つしか選べないので軸ごとに sort 値を持つ形では重ねられなかった。
  // 複数の軸は **スコアの合計**（`SUM`）で 1 本の `feature_score` に畳む。
  // 集約してから JOIN するのは、素直に LEFT JOIN すると軸の数だけ行が増えて
  // 候補行が重複するためである（GROUP BY を外側へ持ち出さずに済む）。
  const featurePairs = (dto.featureKeys ?? []).map((raw) => {
    const parsed = parseMyDishFeatureKey(raw);
    if (!parsed) {
      // 黙って無視すると「選んだのに並びが変わらない」になるので落とす
      throw new BadRequestException(`Invalid featureKeys entry: ${raw}`);
    }
    return parsed;
  });
  const featureJoin = featurePairs.length
    ? Prisma.sql`LEFT JOIN (
           SELECT dish_category_id, SUM(score) AS score
             FROM dish_category_features
            WHERE (feature_type, feature_key) IN (${Prisma.join(
              featurePairs.map(
                ({ featureType, featureKey }) =>
                  Prisma.sql`(${featureType}::text, ${featureKey}::text)`,
              ),
            )})
            GROUP BY dish_category_id
         ) dcf ON dcf.dish_category_id = d.category_id`
    : Prisma.empty;
  const featureScoreExpr = featurePairs.length
    ? Prisma.sql`COALESCE(dcf.score, 0)::double precision`
    : Prisma.sql`NULL::double precision`;

  const rangeFilter = (column: Prisma.Sql): Prisma.Sql => {
    const fromSql = dto.from
      ? Prisma.sql`AND ${column} >= ${new Date(dto.from)}::timestamptz`
      : Prisma.empty;
    const toSql = dto.to
      ? Prisma.sql`AND ${column} <= ${new Date(dto.to)}::timestamptz`
      : Prisma.empty;
    return Prisma.sql`${fromSql} ${toSql}`;
  };

  const minRatingFilter =
    dto.minRating !== undefined
      ? Prisma.sql`AND dr.rating >= ${dto.minRating}::int`
      : Prisma.empty;
  const ratingsFilter = dto.ratings?.length
    ? Prisma.sql`AND dr.rating = ANY(${dto.ratings}::int[])`
    : Prisma.empty;

  const keyset = buildMyDishKeysetPredicate(options.cursor);
  // branchLimit が null（Map ピン）のときは全件が要るので、枝内の並べ替えは無駄。
  const branchTail =
    options.branchLimit === null
      ? Prisma.empty
      : Prisma.sql`ORDER BY ${buildMyDishOrderBy(sort)} LIMIT ${options.branchLimit}`;

  // ------------------------------------------------------------------
  // #1395 M-a: want 枝の絞り込みを `reactions` 実体（フェンスの内側）へ押し込む。
  //
  // `my_save_ids` は `MATERIALIZED` なので、ここで削らなかったぶんは
  // **毎ページ丸ごと読み出されて `DISTINCT ON` のソートに掛かる**。
  //
  // 押し込めるのは **`created_at` の下限側と、ページ間で動かない `to` の上限**だけである。
  // `DISTINCT ON` が選ぶ代表 save は「その dish の最新 save」であり、
  // - 下限（`from` / 昇順カーソル）は古い行しか落とさないので代表は動かない（落ちるのは dish ごと消える場合だけ）
  // - `to` はページ間で動かないので、代表が「期間内の最新 save」に変わっても 1 回のページングの中で一貫する
  //   （「期間内に save した dish を、その期間内の save 日で出す」という Calendar 向きの意味になる）
  // 一方 **降順カーソルの上限（`-occurredAt` / `-rating`）は押し込めない**。
  // 例: dish D を t=10 と t=5 の 2 メディアで save 済み。1 ページ目は代表 10 で D を返す。
  // 2 ページ目でカーソル 7 を上限に押し込むと代表が 5 に化け、`(5) < (7)` を満たして **D が再び出る**。
  // これを防ぐには「この dish に 7 より新しい save が無いか」を引く必要があり、
  // 結局スキップしたはずの行を全部読むので、削減にならない。よって押し込まず、
  // 降順の絞り込みは従来どおり枝の内側（`WHERE ${keyset} ... LIMIT`）で行う。
  const saveBounds: Prisma.Sql[] = [];
  if (dto.from) {
    saveBounds.push(
      Prisma.sql`AND created_at >= ${new Date(dto.from)}::timestamptz`,
    );
  }
  if (dto.to) {
    saveBounds.push(
      Prisma.sql`AND created_at <= ${new Date(dto.to)}::timestamptz`,
    );
  }
  if (options.cursor?.sort === 'occurredAt') {
    // 昇順ページングの keyset は `(occurred_at, row_key) > (X, K)` なので `created_at >= X` が下限になる
    saveBounds.push(
      Prisma.sql`AND created_at >= ${options.cursor.occurredAt}::timestamptz`,
    );
  }
  const saveBoundsSql = saveBounds.length
    ? Prisma.join(saveBounds, ' ')
    : Prisma.empty;

  // #1397 M-a と同じ話: want 枝の店舗絞り込みは `my_save_ids`（MATERIALIZED）の外へは置けない
  // （target_id は dish_media を指すので restaurant まで 2 ジョイン先）。
  // `my_saved_dishes` の JOIN dishes 側へ押し込む。`dishes.restaurant_id` は `dish_id` から
  // 一意に決まるため、この絞り込みは DISTINCT ON (dm.dish_id) が選ぶ代表メディアを変えない（m-7）。
  const restaurantJoin = dto.restaurantId
    ? Prisma.sql`JOIN dishes d ON d.id = dm.dish_id AND d.restaurant_id = ${dto.restaurantId}::uuid`
    : Prisma.empty;

  const ctes = includeWant
    ? Prisma.sql`
    -- (1) 最適化フェンス。ここから外へ出るまで target_id は text のまま扱う
    my_save_ids AS MATERIALIZED (
      SELECT target_id, created_at
      FROM reactions
      WHERE user_id = ${userId}::uuid
        AND target_type = 'dish_media'
        AND action_type = 'save'
        ${saveBoundsSql}
    ),
    -- want 行は dish 単位に畳む。代表メディアは「最新の save 対象メディア」に固定する（m-7）
    my_saved_dishes AS MATERIALIZED (
      SELECT DISTINCT ON (dm.dish_id)
        dm.dish_id           AS dish_id,
        dm.id                AS media_id,
        s.created_at         AS saved_at
      FROM my_save_ids s
      -- #1513 削除された投稿を save したままの reaction は残る（reaction は消さない）。
      -- ここで弾かないと «食べたい» に実体の無いメディアの行が並ぶ
      JOIN dish_media dm ON dm.id = s.target_id::uuid AND dm.deleted_at IS NULL
      ${restaurantJoin}
      ORDER BY dm.dish_id, s.created_at DESC, dm.id DESC
    )`
    : null;

  const wantBranch = Prisma.sql`
    SELECT * FROM (
      SELECT
        'dish:' || sd.dish_id::text AS row_key,
        'want'::text                AS row_status,
        NULL::uuid                  AS review_id,
        sd.dish_id                  AS dish_id,
        sd.saved_at                 AS occurred_at,
        NULL::int                   AS rating,
        sd.media_id                 AS own_media_id,
        ${distanceExpr}             AS distance_meters,
        ${featureScoreExpr}         AS feature_score
      FROM my_saved_dishes sd
      JOIN dishes d      ON d.id = sd.dish_id
      JOIN restaurants r ON r.id = d.restaurant_id
      ${featureJoin}
      -- #1513 レビューを消したら「まだ食べていない」へ戻る。削除済みを «食べた» の
      -- 証拠に数えると、その dish は want にも eaten にも出ない行方不明の状態になる
      WHERE NOT EXISTS (
        SELECT 1 FROM dish_reviews dr2
        WHERE dr2.user_id = ${userId}::uuid
          AND dr2.dish_id = sd.dish_id
          AND dr2.deleted_at IS NULL
      )
      ${categoryFilter}
      ${areaFilter}
      -- from/to は my_save_ids へ押し込み済み（M-a）。ここで重ねて絞らない
    ) w
    WHERE ${keyset}
    ${branchTail}`;

  const eatenBranch = Prisma.sql`
    SELECT * FROM (
      SELECT
        'review:' || dr.id::text AS row_key,
        'eaten'::text            AS row_status,
        dr.id                    AS review_id,
        dr.dish_id               AS dish_id,
        dr.created_at            AS occurred_at,
        dr.rating::int           AS rating,
        dr.created_dish_media_id AS own_media_id,
        ${distanceExpr}          AS distance_meters,
        ${featureScoreExpr}      AS feature_score
      FROM dish_reviews dr
      JOIN dishes d      ON d.id = dr.dish_id
      JOIN restaurants r ON r.id = d.restaurant_id
      ${featureJoin}
      -- #1513 «食べた» 行の実体は自分の dish_reviews なので、論理削除した行は候補に入れない
      WHERE dr.user_id = ${userId}::uuid
        AND dr.deleted_at IS NULL
      ${categoryFilter}
      ${restaurantFilter}
      ${areaFilter}
      ${minRatingFilter}
      ${ratingsFilter}
      ${rangeFilter(Prisma.sql`dr.created_at`)}
    ) e
    WHERE ${keyset}
    ${branchTail}`;

  const candidates =
    includeWant && includeEaten
      ? Prisma.sql`(${wantBranch}) UNION ALL (${eatenBranch})`
      : includeWant
        ? wantBranch
        : eatenBranch;

  return { ctes, candidates };
}

/**
 * GET /v1/users/me/dishes の 1 ページぶんのクエリ。
 *
 * `dish.reviewCount` / `averageRating` と代表メディアのフォールバックは
 * **LIMIT を掛けた後のページ内 dish に限定した LATERAL** で取る（m-5）。
 * 候補集合全体への `GROUP BY` は B-2 と同じ事故になる。
 *
 * #1398 PR1: `dish_categories` への JOIN も同じ理由で `page` CTE より後（`d` は
 * 既に `p.dish_id` = ページ内 dish に絞られている）に置く。`buildMyDishesCandidates`
 * の候補集合側（UNION ALL の各枝）へ置くと、964MB の `dish_reviews` を含む候補集合
 * 全体に対して毎回 join することになり B-2 の事故が再発する。
 *
 * @returns 該当しうる行が構造的に 0 件のときは null（SQL を投げる必要が無い）
 */
export function buildMyDishesPageQuery(
  userId: string,
  dto: QueryMyDishesDto,
  cursor: MyDishCursor | null,
): Prisma.Sql | null {
  const limit = dto.limit ?? 42;
  const sort: MyDishSort = dto.sort ?? '-occurredAt';

  const built = buildMyDishesCandidates(userId, dto, {
    cursor,
    branchLimit: limit + 1,
  });
  if (!built) return null;

  const orderBy = buildMyDishOrderBy(sort);
  // want 枝を組まないときは my_save_ids / my_saved_dishes を出力しない（M-a）
  const cteHead = built.ctes ? Prisma.sql`${built.ctes},` : Prisma.empty;

  return Prisma.sql`
  WITH ${cteHead}
  page AS (
    SELECT * FROM (${built.candidates}) u
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
  )
  SELECT
    p.row_key,
    p.row_status,
    p.review_id,
    p.dish_id,
    p.occurred_at,
    p.rating,
    p.distance_meters,
    p.feature_score,
    ms.saved_at                       AS saved_at,
    COALESCE(om.id, fb.id)            AS media_id,
    -- #1513 【設計】墓標フラグ。own_media_id は非 NULL なのに実体が論理削除済み
    -- （= 自分の投稿を消した）ことを示す。行は消さず、UI 側が「この投稿は削除されました」を
    -- 出すために使う（媒体を別の写真へ差し替えないので media_id は NULL で返る）
    (p.own_media_id IS NOT NULL AND om.id IS NULL) AS is_own_media_deleted,
    ${RESTAURANT_COLUMNS_SQL},
    d.id            AS d_id,
    d.restaurant_id AS d_restaurant_id,
    d.category_id   AS d_category_id,
    d.name          AS d_name,
    d.created_at    AS d_created_at,
    d.updated_at    AS d_updated_at,
    d.lock_no       AS d_lock_no,
    dc.image_url    AS d_category_image_url,
    -- #1375（オーナー指摘「うどんで絞ったら udon が出る」）カテゴリの正式表記。
    -- 表示に使っていた d.name は «その店でのその料理の呼び名» で、SNS 取り込み由来だと
    -- ローマ字や英語のまま入る。カテゴリ表の labels 列（言語コード → 表記）を一緒に返し、
    -- クライアントが «ユーザーの言語の表記 → 無ければ d.name» の順で出せるようにする。
    -- 既に page CTE で LIMIT 済みの d に対する参照なので追加の走査は起きない（image_url と同じ）。
    --
    -- ⚠️ この SQL はテンプレートリテラルの中なので、コメントにバッククォートを書かないこと
    --    （文字列がそこで閉じて構文エラーになる。実際に一度踏んだ）。
    -- ⚠️ コメントにカテゴリ表のテーブル名を書かないこと。my-dishes.sql.spec.ts が
    --    «候補集合の CTE にその名前が出ないこと» で join 位置を見張っており、
    --    コメントでも引っかかる（これも一度踏んだ）。
    dc.labels       AS d_category_labels,
    st.review_count,
    st.average_rating
  FROM page p
  JOIN dishes d           ON d.id = p.dish_id
  JOIN restaurants r      ON r.id = d.restaurant_id
  -- #1398 PR1: カテゴリ画像 URL。page CTE で既に LIMIT 済みの d に対する join なので、
  -- 全候補集合ではなく**ページ内 dish（最大 limit+1 件）にだけ**効く（B-2 の再発防止）。
  JOIN dish_categories dc ON dc.id = d.category_id
  -- 食べたい登録日は「食べた」行にも載せる（save reaction を消さないため保持できる）
  --
  -- #1395 M-a: ここを my_saved_dishes 全体との join にすると、
  -- **status=eaten だけを見ているときでも** ユーザーの save 全件が実体化される。
  -- ページ内の dish（最大 limit+1 件）に限定した LATERAL で引き、
  -- idx_reactions_user_target_id (user_id, target_id) と idx_dish_media_dish (dish_id) に載せる。
  -- 値は my_saved_dishes.saved_at と同じ「その dish の最新 save 日時」で、
  -- from/to の押し込みに引きずられない（表示用の値なので期間で切ってはいけない）。
  LEFT JOIN LATERAL (
    SELECT MAX(sv.created_at) AS saved_at
    FROM dish_media dsv
    JOIN reactions sv
      ON sv.target_id = dsv.id::text
     AND sv.user_id = ${userId}::uuid
     AND sv.target_type = 'dish_media'
     AND sv.action_type = 'save'
    WHERE dsv.dish_id = p.dish_id
      AND dsv.deleted_at IS NULL
  ) ms ON TRUE
  -- #1513 【設計】削除済みの自分のメディアは別の写真へ差し替えず、代表メディア NULL のまま
  -- 返して UI 側で墓標を出す。差し替えると「自分の食べた記録の写真が勝手に別人の写真になる」ため。
  -- om は「own_media_id が指す実体がまだ生きているか」だけを見る LATERAL で、
  -- 死んでいれば media_id は NULL になる（fb へは落ちない）。
  LEFT JOIN LATERAL (
    SELECT dmo.id
    FROM dish_media dmo
    WHERE dmo.id = p.own_media_id
      AND dmo.deleted_at IS NULL
  ) om ON p.own_media_id IS NOT NULL
  -- own_media_id が NULL のときだけ、その dish の最新メディアへ落とす（m-7）
  LEFT JOIN LATERAL (
    SELECT dm2.id
    FROM dish_media dm2
    WHERE dm2.dish_id = p.dish_id
      AND dm2.deleted_at IS NULL
    ORDER BY dm2.created_at DESC, dm2.id DESC
    LIMIT 1
  ) fb ON p.own_media_id IS NULL
  -- ページ内の dish に限定した集計（候補集合全体の GROUP BY はしない）
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int                                 AS review_count,
      COALESCE(AVG(dr3.rating), 0)::double precision AS average_rating
    FROM dish_reviews dr3
    WHERE dr3.dish_id = p.dish_id
      AND dr3.deleted_at IS NULL
  ) st ON TRUE
  ORDER BY ${orderBy}
`;
}

/**
 * #1629 【設計】map-pins の格子セルの大きさ（度）。
 *
 * ## なぜ格子か
 *
 * 上限（`MY_DISH_MAP_PINS_LIMIT`）で切るとき、以前は «最新 300 店舗» を選んでいた。
 * 記録が 300 店舗を超えるユーザーが引きで（日本全体を）見ると、**最近行っていない
 * 地方の記録が地図から丸ごと消える**。この画面の引きの絵が答えるべき問いは
 * 「どこに行ったか」の分布であって「最近どこに行ったか」ではない。
 *
 * そこで店舗を粗い格子セルへ割り、**セルごとの round-robin**（各セルの 1 位を先に、
 * 次に 2 位を…）で 300 件を選ぶ。セル内の順位は新しい順なので、
 * - 記録が 300 店舗以下なら全件（従来と同じ）
 * - 超えるなら «記録のある地域すべてに最低 1 本» を立ててから、残り枠を新しい順に配る
 *
 * ## セルの大きさ
 *
 * - エリア絞り込み無し: 0.5 度（≒ 55km）。引きの絵の分布を保つのが目的なので粗くてよい。
 *   日本全体でも占有セルは高々数十〜百程度で、上限 300 の内側に収まる
 * - エリア絞り込みあり（lat/lng/radius）: 表示直径を `CELLS_PER_AXIS` 分割した値。
 *   寄った範囲の中でも同じ理屈（範囲内の分布を保つ）が効くようにする
 *
 * セル境界の 2 点が別セルへ割れる問題（features/map/clustering.ts が格子を捨てた理由）は
 * ここでは問題にならない。目的が «見かけの畳み» ではなく «選抜の公平さ» なので、
 * 境界で隣のセルに入っても「その地域の代表が立つ」ことは変わらない。
 */
export const MY_DISH_MAP_PINS_DEFAULT_CELL_DEG = 0.5;
export const MY_DISH_MAP_PINS_CELLS_PER_AXIS = 12;
export const MY_DISH_MAP_PINS_MIN_CELL_DEG = 0.002;

/** 赤道上での 1 度あたりのメートル数。セルの粗い縮尺換算にしか使わない */
const METERS_PER_DEGREE = 111_320;

export function myDishMapPinsCellSizeDegrees(dto: {
  lat?: number;
  lng?: number;
  radius?: number;
}): number {
  const hasArea =
    dto.lat !== undefined && dto.lng !== undefined && dto.radius !== undefined;
  if (!hasArea) return MY_DISH_MAP_PINS_DEFAULT_CELL_DEG;
  const diameterDeg = ((dto.radius as number) * 2) / METERS_PER_DEGREE;
  return Math.max(
    diameterDeg / MY_DISH_MAP_PINS_CELLS_PER_AXIS,
    MY_DISH_MAP_PINS_MIN_CELL_DEG,
  );
}

/**
 * GET /v1/users/me/dishes/map-pins のクエリ。
 *
 * Map は「viewport 内のピンを全部」欲しいのでページングしない。
 * 代わりに `MY_DISH_MAP_PINS_LIMIT + 1` 件取り、上限で切られたかを呼び出し元が判定できるようにする。
 */
export function buildMyDishMapPinsQuery(
  userId: string,
  dto: QueryMyDishesDto,
): Prisma.Sql | null {
  // #1397: `restaurantId` は一覧（Sheet）専用のフィルタ。map-pins では無視する
  // （1 店舗のピンを 1 つ返しても意味が無い。共有 DTO に片側だけの必須／禁止を
  // 持ち込むと、以後フィールドを足すたびに分岐が増えるので 400 にもしない）。
  const built = buildMyDishesCandidates(
    userId,
    { ...dto, restaurantId: undefined },
    { cursor: null, branchLimit: null },
  );
  if (!built) return null;

  const cteHead = built.ctes ? Prisma.sql`${built.ctes},` : Prisma.empty;

  // #1629 【設計】上限で切るときの «選び方» は格子セルごとの round-robin（下の cell_rank）。
  // 集約（pin_stats）は従来から候補全行を読む形（枝内 LIMIT なし）だったので、
  // ここで選び方を変えても DB の読み量は増えない。増えるのは
  // restaurants への座標引き（店舗数ぶんの索引参照）と window 関数 1 段だけである。
  const cellDeg = myDishMapPinsCellSizeDegrees(dto);

  return Prisma.sql`
  WITH ${cteHead}
  candidates AS MATERIALIZED (
    SELECT * FROM (${built.candidates}) u
  ),
  pin_stats AS (
    SELECT
      d.restaurant_id                                        AS restaurant_id,
      COUNT(*) FILTER (WHERE c.row_status = 'want')::int      AS want_count,
      COUNT(*) FILTER (WHERE c.row_status = 'eaten')::int     AS eaten_count,
      MAX(c.occurred_at)                                     AS latest_occurred_at
    FROM candidates c
    JOIN dishes d ON d.id = c.dish_id
    GROUP BY d.restaurant_id
  ),
  pins AS (
    SELECT restaurant_id, want_count, eaten_count, latest_occurred_at
    FROM (
      SELECT
        ps.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            FLOOR(r2.latitude  / ${cellDeg}::double precision),
            FLOOR(r2.longitude / ${cellDeg}::double precision)
          ORDER BY ps.latest_occurred_at DESC, ps.restaurant_id DESC
        ) AS cell_rank
      FROM pin_stats ps
      JOIN restaurants r2 ON r2.id = ps.restaurant_id
    ) ranked
    ORDER BY cell_rank ASC, latest_occurred_at DESC, restaurant_id DESC
    LIMIT ${MY_DISH_MAP_PINS_LIMIT + 1}
  )
  SELECT
    ${RESTAURANT_COLUMNS_SQL},
    p.want_count,
    p.eaten_count,
    p.latest_occurred_at,
    dm.id                          AS media_id,
    dm.thumbnail_path              AS media_thumbnail_path,
    dm.thumbnail_processing_status AS media_thumbnail_processing_status,
    -- #1513 【設計】一覧（buildMyDishesPageQuery）と同じ墓標フラグ。
    -- ピンの代表行の own_media_id が削除済みメディアを指しているとき true
    (top.own_media_id IS NOT NULL AND om.id IS NULL) AS is_own_media_deleted,
    -- #1375 独立レビュー（仕様ギャップ G4）: SNS 取り込みは自ストレージへの複製に失敗し得るため
    -- dish_media.thumbnail_path が空のまま正常系で存在する。同じフォールバックが効くよう
    -- 埋め込み側の URL も返す（Map ピンだけ店舗の外観写真へ化けるのを防ぐ）
    dmee.thumbnail_url             AS media_external_thumbnail_url
  FROM pins p
  JOIN restaurants r ON r.id = p.restaurant_id
  -- ピンの代表メディアは「その店舗で最も新しい行」の代表メディアに固定する（m-7）
  LEFT JOIN LATERAL (
    SELECT c2.own_media_id, c2.dish_id
    FROM candidates c2
    JOIN dishes d2 ON d2.id = c2.dish_id
    WHERE d2.restaurant_id = p.restaurant_id
    ORDER BY c2.occurred_at DESC, c2.row_key DESC
    LIMIT 1
  ) top ON TRUE
  -- #1513 【設計】一覧（buildMyDishesPageQuery の om）と同じ扱い。削除済みメディアを指した
  -- own_media_id は別の写真へ差し替えず、代表メディア NULL のまま返して UI 側で墓標を出す。
  -- 差し替えると「自分の食べた記録の写真が勝手に別人の写真になる」ため。
  LEFT JOIN LATERAL (
    SELECT dmo.id
    FROM dish_media dmo
    WHERE dmo.id = top.own_media_id
      AND dmo.deleted_at IS NULL
  ) om ON top.own_media_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT dm3.id
    FROM dish_media dm3
    WHERE dm3.dish_id = top.dish_id
      AND dm3.deleted_at IS NULL
    ORDER BY dm3.created_at DESC, dm3.id DESC
    LIMIT 1
  ) fb ON top.own_media_id IS NULL
  LEFT JOIN dish_media dm ON dm.id = COALESCE(om.id, fb.id)
  LEFT JOIN dish_media_external_embeddings dmee ON dmee.dish_media_id = dm.id
  ORDER BY p.latest_occurred_at DESC
`;
}

/**
 * #1395 m-e: want 側の `meta.oldestOccurredAt` を求める SQL。
 *
 * 一覧の want 行の `occurredAt` は `DISTINCT ON (dish_id) ... ORDER BY created_at DESC` で
 * 選ぶ「その dish の最新 save」なので、最古を出すときも **dish ごとに最新 save を畳んでから
 * MIN を取る**必要がある。単純な `MIN(reactions.created_at)` だと、同じ dish を古い日付と
 * 新しい日付の 2 回 save したとき、一覧には新しい日付で出るのに oldestOccurredAt は古い日付を
 * 返し、Calendar が「一覧に無い月まで遡れる」と表示してしまう。
 *
 * 「既に食べた dish の save」を除く NOT EXISTS（m-b）は dish ごとの集約の内側で効かせる。
 *
 * ⚠️ target_id::uuid は MATERIALIZED フェンスの外側でだけ行う（M-1 と同じ理由。
 *    dish_categories.id は TEXT なので `::uuid` にすると落ちる target_id が実在する）。
 */
export function buildMyDishesOldestWantSaveQuery(userId: string): Prisma.Sql {
  return Prisma.sql`
    WITH my_save_ids AS MATERIALIZED (
      SELECT target_id, created_at
      FROM reactions
      WHERE user_id = ${userId}::uuid
        AND target_type = 'dish_media'
        AND action_type = 'save'
    )
    SELECT MIN(latest) AS oldest
    FROM (
      SELECT dm.dish_id, MAX(s.created_at) AS latest
      FROM my_save_ids s
      -- #1513 一覧（my_saved_dishes）と同じ条件で畳まないと、
      -- 削除済みメディアぶんだけ Calendar が「一覧に無い月まで遡れる」と表示してしまう
      JOIN dish_media dm ON dm.id = s.target_id::uuid AND dm.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM dish_reviews dr
        WHERE dr.user_id = ${userId}::uuid
          AND dr.dish_id = dm.dish_id
          AND dr.deleted_at IS NULL
      )
      GROUP BY dm.dish_id
    ) t
  `;
}
