import {
  buildMyDishMapPinsQuery,
  buildMyDishesCandidates,
  buildMyDishesOldestWantSaveQuery,
  buildMyDishesPageQuery,
  decodeMyDishCursor,
  encodeMyDishCursor,
  hasMyDishesFilterBeyondStatus,
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

  /* ---------------- #1398 PR1: dish_categories.image_url をページ内 dish に限定した join で取る ---------------- */

  it('d_category_image_url を SELECT し、dish_categories の join を page CTE より後（ページ内 dish 限定）に置く', () => {
    const sql = buildSql({});

    expect(sql).toContain('dc.image_url AS d_category_image_url');

    // join 自体は 1 箇所だけで、page CTE の外（= 既に LIMIT された p.dish_id に対して）にあること。
    // buildMyDishesCandidates（UNION ALL の各枝、964MB の dish_reviews を含む候補集合全体）側に
    // 置くと B-2 の事故（毎ページ全件読み）が再発するため、位置を固定する。
    const joins =
      sql.match(/JOIN dish_categories dc ON dc\.id = d\.category_id/g) ?? [];
    expect(joins).toHaveLength(1);

    const fromPageIndex = sql.indexOf('FROM page p');
    const joinIndex = sql.indexOf(
      'JOIN dish_categories dc ON dc.id = d.category_id',
    );
    expect(fromPageIndex).toBeGreaterThan(-1);
    // join は `FROM page p` より後（= page CTE で既に LIMIT 済みの行に対してだけ）にあること
    expect(joinIndex).toBeGreaterThan(fromPageIndex);
    // page CTE 自体（`u` エイリアスの候補集合、LIMIT 前）には現れないこと
    const pageCte = sql.slice(sql.indexOf('page AS ('), fromPageIndex);
    expect(pageCte).not.toContain('dish_categories');

    // 候補行を組み立てる buildMyDishesCandidates 側（want / eaten 枝）には現れないこと
    const { candidates } = buildMyDishesCandidates(
      USER_ID,
      {},
      {
        cursor: null,
        branchLimit: 11,
      },
    )!;
    expect(normalize(candidates.sql)).not.toContain('dish_categories');
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

  /* ---------------- #1397: restaurantId ---------------- */

  const RESTAURANT_ID = '44444444-4444-4444-4444-444444444444';

  it('restaurantId 未指定時は SQL が 1 文字も変わらない（既存挙動の不変）', () => {
    const withoutFilter = buildSql({});
    const withUndefined = buildSql({ restaurantId: undefined });

    expect(withUndefined).toEqual(withoutFilter);
  });

  it('restaurantId 指定時、eaten 枝は categoryFilter の隣（枝の内側）に述語が出る', () => {
    const sql = buildSql({
      categoryIds: ['Q1338822'],
      restaurantId: RESTAURANT_ID,
    });
    const [, eatenBranch] = sql.split('UNION ALL');

    // categoryFilter の直後に restaurantFilter が続く（同じ WHERE 節の中、areaFilter の手前）
    const categoryIdx = eatenBranch.indexOf('AND d.category_id = ANY(');
    const restaurantIdx = eatenBranch.indexOf('AND d.restaurant_id =');
    expect(categoryIdx).toBeGreaterThan(-1);
    expect(restaurantIdx).toBeGreaterThan(categoryIdx);
  });

  it('restaurantId 指定時、eaten 枝に AND d.restaurant_id = $n::uuid が出る', () => {
    const sql = buildSql({ restaurantId: RESTAURANT_ID });
    const [, eatenBranch] = sql.split('UNION ALL');

    expect(eatenBranch).toContain('AND d.restaurant_id =');
    expect(eatenBranch).toContain('::uuid');
    expect(lastQuery!.values).toContain(RESTAURANT_ID);
  });

  it('restaurantId 指定時、want 枝には述語を置かず my_saved_dishes CTE の JOIN dishes 側へ押し込む', () => {
    const sql = buildSql({ restaurantId: RESTAURANT_ID });

    // my_saved_dishes CTE の JOIN dishes 側に出る
    const cte = sql.slice(
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
      sql.indexOf('page AS ('),
    );
    expect(cte).toContain(
      'JOIN dishes d ON d.id = dm.dish_id AND d.restaurant_id =',
    );
    // DISTINCT ON (dm.dish_id) の代表選択（m-7）は変えていない
    expect(cte).toContain('ORDER BY dm.dish_id, s.created_at DESC, dm.id DESC');

    // want 枝本体（page CTE 内、my_saved_dishes を読む SELECT）には述語を置かない
    // （NOT EXISTS より後、categoryFilter と同じ位置には出さない）
    const wantSelect = sql.slice(
      sql.indexOf('page AS ('),
      sql.indexOf('UNION ALL'),
    );
    expect(wantSelect).not.toContain('AND d.restaurant_id =');
  });

  it('restaurantId 指定時も my_save_ids（MATERIALIZED フェンス）の内側には現れない（M-1 と同じ理由）', () => {
    const sql = buildSql({ restaurantId: RESTAURANT_ID });
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
    );

    expect(fence).not.toContain('restaurant_id');
  });

  it('meta.oldestOccurredAt の算出条件（hasMyDishesFilterBeyondStatus）は restaurantId 指定時にフィルタありと判定する', () => {
    // #1397: restaurantId を取りこぼすと、Sheet を開くたびに #1395 B-2 の全行走査が走る
    expect(hasMyDishesFilterBeyondStatus({})).toBe(false);
    expect(hasMyDishesFilterBeyondStatus({ restaurantId: RESTAURANT_ID })).toBe(
      true,
    );
    // status だけの指定では引き続きフィルタなし扱い（既存挙動）
    expect(hasMyDishesFilterBeyondStatus({ restaurantId: undefined })).toBe(
      false,
    );
  });

  it('map-pins は restaurantId を無視する（枝にも CTE にも現れない）', () => {
    const query = buildMyDishMapPinsQuery(USER_ID, {
      restaurantId: RESTAURANT_ID,
    });
    expect(query).not.toBeNull();
    const sql = normalize(query!.sql);

    expect(sql).not.toContain('d.restaurant_id =');
    expect(sql).not.toContain(RESTAURANT_ID);
    expect(query!.values).not.toContain(RESTAURANT_ID);
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
    // eaten は dish_reviews 実体に対して絞る
    expect(sql).toContain('AND dr.created_at >=');
    expect(sql).toContain('AND dr.created_at <=');
    // want は reactions 実体（my_save_ids）に対して絞る（M-a）
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
    );
    expect(fence).toContain('AND created_at >=');
    expect(fence).toContain('AND created_at <=');
  });

  /* ---------------- M-a: want 枝も reactions 実体の側で削る ---------------- */

  it('want 枝にも keyset と LIMIT が入る（マージ後だけに頼らない）', () => {
    const cursor = decodeMyDishCursor(
      '-occurredAt',
      encodeMyDishCursor('-occurredAt', {
        row_key: 'dish:33333333-3333-3333-3333-333333333333',
        occurred_at: new Date('2026-08-17T09:30:00.000Z'),
        rating: null,
        distance_meters: null,
        feature_score: null,
      }),
    );

    const sql = buildSql({ limit: 10 }, cursor);
    const [wantBranch] = sql.split('UNION ALL');

    // want 枝の内側に keyset 述語がある
    expect(wantBranch).toContain(') w WHERE (occurred_at, row_key) <');
    // want 枝の内側で ORDER BY + LIMIT まで済ませる
    expect(wantBranch).toContain(
      'ORDER BY occurred_at DESC, row_key DESC LIMIT',
    );
    // want / eaten / page の 3 箇所に limit+1 を渡す
    expect(lastQuery!.values.filter((v) => v === 11)).toHaveLength(3);
  });

  it('昇順ページングの keyset は my_save_ids（reactions 実体）へ押し込む', () => {
    const cursor = decodeMyDishCursor(
      'occurredAt',
      encodeMyDishCursor('occurredAt', {
        row_key: 'dish:33333333-3333-3333-3333-333333333333',
        occurred_at: new Date('2026-08-17T09:30:00.000Z'),
        rating: null,
        distance_meters: null,
        feature_score: null,
      }),
    );

    const sql = buildSql({ sort: 'occurredAt' }, cursor);
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
    );

    // idx_reactions_profile_cursor (user_id, target_type, action_type, created_at DESC, id) に
    // 範囲を食わせる。ここで削らないと毎ページ save 全件のソートが走る
    expect(fence).toContain('AND created_at >=');
  });

  it('降順ページングの上限は my_save_ids へ押し込まない（代表 save がずれて行が重複するため）', () => {
    const cursor = decodeMyDishCursor(
      '-occurredAt',
      encodeMyDishCursor('-occurredAt', {
        row_key: 'dish:33333333-3333-3333-3333-333333333333',
        occurred_at: new Date('2026-08-17T09:30:00.000Z'),
        rating: null,
        distance_meters: null,
        feature_score: null,
      }),
    );

    const sql = buildSql({}, cursor);
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf('my_saved_dishes AS MATERIALIZED ('),
    );

    // DISTINCT ON が選ぶ代表 save は「その dish の最新 save」なので、
    // 上限を押し込むと 2 ページ目で代表が古い save に化け、同じ dish が再び出てしまう
    expect(fence).not.toContain('AND created_at <=');
  });

  it('status=eaten だけなら save 全件の CTE を組み立てない', () => {
    const sql = buildSql({ status: ['eaten'] });

    // my_save_ids / my_saved_dishes を実体化しない（毎ページの全件ソートが消える）
    expect(sql).not.toContain('my_save_ids AS MATERIALIZED (');
    expect(sql).not.toContain('my_saved_dishes AS MATERIALIZED (');
    expect(sql).not.toContain('FROM my_saved_dishes');
    expect(sql).toContain('WITH page AS (');
  });

  it('savedAt はページ内の dish に限定した LATERAL で引く', () => {
    const sql = buildSql({});

    const afterPage = sql.slice(sql.indexOf('FROM page p'));
    // my_saved_dishes 全体との join にすると status=eaten のときにも全件走査になる
    expect(afterPage).not.toContain('LEFT JOIN my_saved_dishes');
    expect(afterPage).toContain('SELECT MAX(sv.created_at) AS saved_at');
    expect(afterPage).toContain('WHERE dsv.dish_id = p.dish_id');
    // uuid -> text の向きにだけキャストする（text -> uuid は M-1 の事故）
    expect(afterPage).toContain('sv.target_id = dsv.id::text');
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

describe('buildMyDishesOldestWantSaveQuery が組み立てる SQL', () => {
  /* ---------------- m-e: oldestOccurredAt は dish ごとの最新 save の MIN ---------------- */

  it('dish ごとに MAX(created_at) を取ってから MIN する（単純な MIN(created_at) には戻らない）', () => {
    const sql = normalize(buildMyDishesOldestWantSaveQuery(USER_ID).sql);

    // 一覧の DISTINCT ON ... ORDER BY created_at DESC と同じ代表（dish ごとの最新 save）に揃える
    expect(sql).toContain('SELECT MIN(latest) AS oldest FROM (');
    expect(sql).toContain('SELECT dm.dish_id, MAX(s.created_at) AS latest');
    expect(sql).toContain('GROUP BY dm.dish_id');

    // 素朴な MIN(created_at) には戻っていないこと
    expect(sql).not.toContain('MIN(s.created_at) AS oldest');
  });

  it('既に食べた dish の save は dish ごとの集約の内側で NOT EXISTS で除く（m-b）', () => {
    const sql = normalize(buildMyDishesOldestWantSaveQuery(USER_ID).sql);
    const grouped = sql.slice(
      sql.indexOf('SELECT dm.dish_id, MAX(s.created_at)'),
      sql.indexOf('GROUP BY dm.dish_id') + 'GROUP BY dm.dish_id'.length,
    );

    expect(grouped).toContain('WHERE NOT EXISTS (');
    expect(grouped).toContain('FROM dish_reviews dr');
    expect(grouped).toContain('AND dr.dish_id = dm.dish_id');
  });

  it('target_id::uuid は MATERIALIZED フェンスの外側でだけ行う（M-1 と同じ理由）', () => {
    const sql = normalize(buildMyDishesOldestWantSaveQuery(USER_ID).sql);
    const fence = sql.slice(
      sql.indexOf('my_save_ids AS MATERIALIZED ('),
      sql.indexOf(')'),
    );

    expect(sql).toContain('my_save_ids AS MATERIALIZED (');
    expect(fence).not.toContain('target_id::uuid');
    expect(sql).toContain(
      'FROM my_save_ids s JOIN dish_media dm ON dm.id = s.target_id::uuid',
    );
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
