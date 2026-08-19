import {
  buildMyDishMapPinsQuery,
  buildMyDishesPageQuery,
  decodeMyDishCursor,
  encodeMyDishCursor,
  MyDishCursor,
} from './my-dishes.query';
import { QueryMyDishesDto } from '@shared/v1/dto';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const normalize = (sql: string) => sql.replace(/\s+/g, ' ');

/**
 * #1395 生成される SQL の性質を固定するテスト。
 *
 * DB を立てずに検証できるのは「どう問い合わせるか」までだが、
 * 本 Issue の Blocker / Major はいずれも **クエリの形**の問題だったので、
 * 形が崩れたら落ちるようにしておく。
 */
describe('buildMyDishesPageQuery が組み立てる SQL', () => {
  let lastQuery: ReturnType<typeof buildMyDishesPageQuery>;

  const buildSql = (
    dto: Partial<QueryMyDishesDto>,
    cursor: MyDishCursor | null = null,
  ): string => {
    lastQuery = buildMyDishesPageQuery(USER_ID, dto, cursor);
    expect(lastQuery).not.toBeNull();
    return normalize(lastQuery!.sql);
  };

  /* ---------------- M-1: reactions.target_id の型安全性 ---------------- */

  it('target_id のキャストは MATERIALIZED フェンスの外側でだけ行う', () => {
    const sql = buildSql({});

    // フェンス。ここまでは target_id は text のまま
    expect(sql).toContain('my_save_ids AS MATERIALIZED (');
    expect(sql).toContain("target_type = 'dish_media'");
    // キャストはフェンスを通した後にだけ現れる
    expect(sql).toContain(
      'FROM my_save_ids s JOIN dish_media dm ON dm.id = s.target_id::uuid',
    );

    // フェンスの内側（reactions を直接読む部分）に ::uuid が無いこと。
    // dish_categories.id は TEXT（Wikidata QID）で、非 UUID の target_id が実在するため
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
    );
    // user_id は uuid 列なのでキャストされるが、target_id は text のまま出ていくこと
    expect(fence).not.toContain('target_id::uuid');
  });

  /* ---------------- B-2: LIMIT を枝の内側へ押し込む ---------------- */

  it('LIMIT を UNION ALL の各枝の内側へ押し込み、マージ後にもう一度 limit する', () => {
    const sql = buildSql({ limit: 10 });

    const [beforeUnion, afterUnion] = sql.split('UNION ALL');
    // want 枝（UNION ALL の前）に ORDER BY + LIMIT がある
    expect(beforeUnion).toContain('ORDER BY');
    expect(beforeUnion).toContain('LIMIT');
    // eaten 枝（UNION ALL の後）にもある
    expect(afterUnion).toContain('ORDER BY');
    // マージ後の page CTE でもう一度 limit する
    expect(sql).toContain('page AS ( SELECT * FROM (');
    // limit + 1 を 3 箇所（want / eaten / page）に渡している
    expect(lastQuery!.values.filter((v) => v === 11)).toHaveLength(3);
  });

  it('want 行の除外は CTE ではなく dish_reviews の実体に対する NOT EXISTS で引く', () => {
    const sql = buildSql({});

    expect(sql).toContain(
      'WHERE NOT EXISTS ( SELECT 1 FROM dish_reviews dr2 WHERE dr2.user_id =',
    );
    expect(sql).toContain('AND dr2.dish_id = sd.dish_id');
  });

  /* ---------------- B-1: -rating で want 行が消えない ---------------- */

  it('-rating の 2 ページ目でも want 枝を投げる', () => {
    // 1 ページ目の末尾が eaten 行（★4）だったときのカーソル
    const cursor = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', {
        row_key: 'review:22222222-2222-2222-2222-222222222222',
        occurred_at: new Date('2026-08-18T09:30:00.000Z'),
        rating: 4,
        distance_meters: null,
        feature_score: null,
      }),
    );

    const sql = buildSql({ sort: '-rating' }, cursor);

    // want 枝が消えていないこと（ここが Blocker だった）
    expect(sql).toContain("'want'::text");
    expect(sql).toContain("'eaten'::text");
    // NULL 判定を第1ソートキーへ持ち上げていること
    expect(sql).toContain('(rating IS NULL) ASC, rating DESC');
    expect(sql).toContain('((rating IS NULL)::int) >');
  });

  it('-rating のカーソルが want 区画に入ったら eaten 枝は投げない', () => {
    const cursor = decodeMyDishCursor(
      '-rating',
      encodeMyDishCursor('-rating', {
        row_key: 'dish:33333333-3333-3333-3333-333333333333',
        occurred_at: new Date('2026-08-17T09:30:00.000Z'),
        rating: null,
        distance_meters: null,
        feature_score: null,
      }),
    );

    const sql = buildSql({ sort: '-rating' }, cursor);

    expect(sql).toContain("'want'::text");
    expect(sql).not.toContain("'eaten'::text");
  });

  /* ---------------- m-4: 評価フィルタは want を落とす ---------------- */

  it('評価フィルタが付いたら want 枝は投げない（want は rating を持たない）', () => {
    const sql = buildSql({ minRating: 4 });

    expect(sql).not.toContain("'want'::text");
    expect(sql).toContain('AND dr.rating >=');
  });

  it('ratings（★n のみ）でも同じ', () => {
    const sql = buildSql({ ratings: [5] });

    expect(sql).not.toContain("'want'::text");
    expect(sql).toContain('AND dr.rating = ANY(');
  });

  it('status で片方だけ指定したらもう片方の枝は投げない', () => {
    expect(buildSql({ status: ['want'] })).not.toContain("'eaten'::text");
    expect(buildSql({ status: ['eaten'] })).not.toContain("'want'::text");
  });

  it('want のみ + 評価フィルタは 1 件も該当しないのでクエリを組み立てない', () => {
    // Repository はこの null を見て SQL を投げずに空を返す
    expect(
      buildMyDishesPageQuery(USER_ID, { status: ['want'], minRating: 4 }, null),
    ).toBeNull();
  });

  /* ---------------- m-5: 集計はページ内に限定した LATERAL ---------------- */

  it('reviewCount / averageRating は LIMIT 後のページ内 dish に限定した LATERAL で取る', () => {
    const sql = buildSql({});

    const afterPage = sql.slice(sql.indexOf('FROM page p'));
    expect(afterPage).toContain('LEFT JOIN LATERAL ( SELECT COUNT(*)::int');
    expect(afterPage).toContain(
      'FROM dish_reviews dr3 WHERE dr3.dish_id = p.dish_id',
    );
    // 候補集合全体に GROUP BY を掛けていないこと
    expect(sql).not.toContain('GROUP BY dr3.dish_id');
  });

  /* ---------------- m-6: ブロックは効かせない ---------------- */

  it('ブロック（action_type=block）を自分の食事ログに効かせない', () => {
    const sql = buildSql({});

    expect(sql).not.toContain("'block'");
    expect(sql).not.toContain('blocked_categories');
  });

  /* ---------------- m-7: 代表メディアの選び方を固定する ---------------- */

  it('want は最新の save 対象メディア、eaten は created_dish_media_id を代表にする', () => {
    const sql = buildSql({});

    // want: DISTINCT ON で dish ごとに 1 件、同時刻は dish_media.id 降順で決定的に選ぶ
    expect(sql).toContain(
      'SELECT DISTINCT ON (dm.dish_id) dm.dish_id AS dish_id, dm.id AS media_id',
    );
    expect(sql).toContain('ORDER BY dm.dish_id, s.created_at DESC, dm.id DESC');
    // eaten: created_dish_media_id。NULL のときだけ dish の最新メディアへ落とす
    expect(sql).toContain('dr.created_dish_media_id AS own_media_id');
    expect(sql).toContain('fb ON p.own_media_id IS NULL');
  });

  /* ---------------- エリア / カテゴリ / 期間 / 特徴量 ---------------- */

  it('エリア絞り込みは ST_DWithin（既存の GIST 索引を使う）', () => {
    const sql = buildSql({ lat: 35.68, lng: 139.76, radius: 1000 });

    expect(sql).toContain('ST_DWithin(r.location, ST_MakePoint(');
    expect(sql).toContain('ST_Distance(r.location, ST_MakePoint(');
    // 索引の効かないバウンディングボックス + acos は踏襲しない
    expect(sql).not.toContain('acos(');
  });

  it('エリア未指定なら distance_meters は NULL', () => {
    const sql = buildSql({});

    expect(sql).toContain('NULL::double precision AS distance_meters');
    expect(sql).not.toContain('ST_DWithin');
  });

  it('カテゴリと期間は各枝の内側で絞る', () => {
    const sql = buildSql({
      categoryIds: ['Q1338822'],
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    });

    expect(sql).toContain('AND d.category_id = ANY(');
    expect(sql).toContain('AND sd.saved_at >=');
    expect(sql).toContain('AND dr.created_at <=');
  });

  it('scene / timeSlot は既存 dish_category_features のスコアで並び替える（絞り込まない）', () => {
    const sql = buildSql({ sort: '-sceneScore', sceneKey: 'date' });

    // 既存 dish-categories.repository.ts と同じ作法（LEFT JOIN + COALESCE）
    expect(sql).toContain('LEFT JOIN dish_category_features dcf');
    expect(sql).toContain('COALESCE(dcf.score, 0)::double precision');
    expect(sql).toContain('feature_score DESC');
    // INNER JOIN にすると「スコアの無いカテゴリが消える」＝絞り込みになってしまう。
    // dish_category_features への JOIN が全て LEFT JOIN であることを確認する
    const allJoins = sql.match(/JOIN dish_category_features/g) ?? [];
    const leftJoins = sql.match(/LEFT JOIN dish_category_features/g) ?? [];
    expect(allJoins.length).toBeGreaterThan(0);
    expect(leftJoins.length).toBe(allJoins.length);
  });
});

describe('buildMyDishMapPinsQuery が組み立てる SQL', () => {
  it('店舗単位に畳み、上限 + 1 件取って truncated を判定する', () => {
    const query = buildMyDishMapPinsQuery(USER_ID, {});
    expect(query).not.toBeNull();
    const sql = normalize(query!.sql);

    expect(sql).toContain('GROUP BY d.restaurant_id');
    expect(sql).toContain("COUNT(*) FILTER (WHERE c.row_status = 'want')::int");
    // 上限で切られたことを検知するため +1 件取る
    expect(query!.values).toContain(301);
    // Map は全件が要るので枝の内側で limit しない
    const [beforeUnion] = sql.split('UNION ALL');
    expect(beforeUnion).not.toContain('LIMIT');
    // 一覧と同じフェンスを使う（map-pins だけ ::uuid が裸になっていないこと）
    expect(sql).toContain('my_save_ids AS MATERIALIZED (');
  });
});
