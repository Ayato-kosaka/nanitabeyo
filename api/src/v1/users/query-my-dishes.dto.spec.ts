import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryMyDishesDto } from '@shared/v1/dto/users/query-my-dishes.dto';

const validate = (query: Record<string, unknown>) => {
  const dto = plainToInstance(QueryMyDishesDto, query, {
    enableImplicitConversion: false,
  });
  return { dto, errors: validateSync(dto) };
};

const propertiesWithErrors = (query: Record<string, unknown>) =>
  validate(query)
    .errors.map((e) => e.property)
    .sort();

describe('QueryMyDishesDto', () => {
  it('全て未指定でも通る（既定は want + eaten / -occurredAt / 42 件）', () => {
    const { dto, errors } = validate({});

    expect(errors).toEqual([]);
    // 既定値は DTO ではなくサーバ側で解決する（クエリ契約は「未指定」を表現できること）
    expect(dto.status).toBeUndefined();
    expect(dto.sort).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  it('status は CSV でも repeated でも配列になる', () => {
    expect(validate({ status: 'want,eaten' }).dto.status).toEqual([
      'want',
      'eaten',
    ]);
    expect(validate({ status: ['want', 'eaten'] }).dto.status).toEqual([
      'want',
      'eaten',
    ]);
  });

  it('status に未知の値は通さない', () => {
    expect(propertiesWithErrors({ status: 'cooked' })).toEqual(['status']);
  });

  /* ---- lat / lng / radius は 3 点セット。部分指定は 400 にする ---- */

  it('3 点そろっていれば通る', () => {
    expect(
      validate({ lat: '35.68', lng: '139.76', radius: '1000' }).errors,
    ).toEqual([]);
  });

  it.each([
    [{ lat: '35.68' }, ['lng', 'radius']],
    [{ lng: '139.76' }, ['lat', 'radius']],
    [{ radius: '1000' }, ['lat', 'lng']],
    [{ lat: '35.68', lng: '139.76' }, ['radius']],
  ])('部分指定 %j は不足分を 400 にする', (query, expected) => {
    expect(propertiesWithErrors(query)).toEqual(expected);
  });

  it('sort=distance は lat/lng/radius を必須にする', () => {
    expect(propertiesWithErrors({ sort: 'distance' })).toEqual([
      'lat',
      'lng',
      'radius',
    ]);
    expect(
      validate({ sort: 'distance', lat: '35.68', lng: '139.76', radius: '500' })
        .errors,
    ).toEqual([]);
  });

  it('緯度・経度・半径の範囲外は弾く', () => {
    expect(
      propertiesWithErrors({ lat: '91', lng: '139.76', radius: '1000' }),
    ).toEqual(['lat']);
    expect(
      propertiesWithErrors({ lat: '35.68', lng: '139.76', radius: '999999' }),
    ).toEqual(['radius']);
  });

  /* ---- 評価 ---- */

  it('ratings は CSV を数値配列にする', () => {
    expect(validate({ ratings: '4,5' }).dto.ratings).toEqual([4, 5]);
  });

  it('★の範囲外は弾く', () => {
    expect(propertiesWithErrors({ minRating: '6' })).toEqual(['minRating']);
    expect(propertiesWithErrors({ ratings: '0' })).toEqual(['ratings']);
  });

  /* ---- シチュエーション・時間帯は「並び替え」であって「絞り込み」ではない ---- */

  it('sort=-featureScore は featureKeys を必須にする', () => {
    expect(propertiesWithErrors({ sort: '-featureScore' })).toEqual([
      'featureKeys',
    ]);
    expect(
      validate({ sort: '-featureScore', featureKeys: 'scene:date' }).errors,
    ).toEqual([]);
  });

  it('featureKeys は "<feature_type>:<feature_key>" の形だけ通す', () => {
    // カンマ区切り・繰り返しの両方を受ける（他の配列パラメータと同じ作法）
    expect(
      validate({
        sort: '-featureScore',
        featureKeys: 'timeSlot:dinner,scene:friends,dining_pace:quick',
      }).errors,
    ).toEqual([]);
    // 区切りが無い / キーが空 は形の時点で弾く
    expect(
      propertiesWithErrors({ sort: '-featureScore', featureKeys: 'dinner' }),
    ).toEqual(['featureKeys']);
    expect(
      propertiesWithErrors({ sort: '-featureScore', featureKeys: 'timeSlot:' }),
    ).toEqual(['featureKeys']);
  });

  it('未知の sort は通さない', () => {
    expect(propertiesWithErrors({ sort: '-likes' })).toEqual(['sort']);
  });

  /* ---- ページング ---- */

  it('limit は 1..100', () => {
    expect(validate({ limit: '100' }).errors).toEqual([]);
    expect(propertiesWithErrors({ limit: '101' })).toEqual(['limit']);
    expect(propertiesWithErrors({ limit: '0' })).toEqual(['limit']);
  });

  it('categoryIds は 50 件まで', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `Q${i}`);
    expect(propertiesWithErrors({ categoryIds: ids.join(',') })).toEqual([
      'categoryIds',
    ]);
  });

  /* ---- #1397: restaurantId ---- */

  it('restaurantId は未指定でも通る', () => {
    expect(validate({}).errors).toEqual([]);
    expect(validate({}).dto.restaurantId).toBeUndefined();
  });

  it('restaurantId は UUID なら通る', () => {
    expect(
      validate({ restaurantId: '4b6b3b7a-2f1a-4c3e-8b1a-2f1a4c3e8b1a' }).errors,
    ).toEqual([]);
  });

  it('restaurantId が UUID でなければ弾く', () => {
    expect(propertiesWithErrors({ restaurantId: 'not-a-uuid' })).toEqual([
      'restaurantId',
    ]);
  });
});

/**
 * #1599 `@IsISO8601()` は ISO 8601 の «形» を見るだけで、JavaScript の `Date` が
 * 解釈できるかは見ない。ISO 8601 には週日付（`2026-W01`）や基本形式（`20260826`）もあり、
 * 規格として正しいのに `new Date()` では Invalid Date になる。
 *
 * `my-dishes.query.ts` の `rangeFilter` / `saveBounds` は受け取った文字列を
 * `new Date(...)` して **そのままクエリの条件に載せる**（4 箇所）ので、
 * この差がそのままバグになる。
 */
describe('#1599 QueryMyDishesDto の from / to は new Date() が解釈できる形だけ通す', () => {
  it.each([
    ['2026-08-26', '日付だけ'],
    ['2026-08-26T00:00:00Z', '日時（Z）'],
    ['2026-08-26T09:30:00+09:00', '日時（オフセット）'],
    ['2026-08-26T00:00:00.000Z', 'ミリ秒つき'],
    ['2026-08', '年月'],
    ['2026', '年だけ'],
  ])('%s は通る（%s）', (value) => {
    expect(propertiesWithErrors({ from: value })).toEqual([]);
    expect(propertiesWithErrors({ to: value })).toEqual([]);
    // 通した以上、呼び出し側が new Date() しても壊れないこと
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
  });

  it.each([
    ['2026-W01', '週日付。ISO 8601 だが new Date() は Invalid Date'],
    ['2026-W01-1', '週日付（曜日つき）。同上'],
    ['20260826', '基本形式（ハイフン無し）。同上'],
  ])('%s は弾く（%s）', (value) => {
    // 前提: これらは @IsISO8601() だけなら通ってしまう形である
    expect(Number.isNaN(new Date(value).getTime())).toBe(true);

    expect(propertiesWithErrors({ from: value })).toEqual(['from']);
    expect(propertiesWithErrors({ to: value })).toEqual(['to']);
  });

  it('2026-02-30 は弾く（new Date() が黙って 3/2 へ繰り上げてしまう）', () => {
    // 通してしまうと「2 月 30 日以降」で検索したつもりが 3 月 2 日以降になる。
    // 例外にならないぶん、こちらの方が気づきにくい
    expect(new Date('2026-02-30').toISOString()).toBe('2026-03-02T00:00:00.000Z');

    expect(propertiesWithErrors({ from: '2026-02-30' })).toEqual(['from']);
  });

  it('そもそも日付でない文字列も従来どおり弾く', () => {
    expect(propertiesWithErrors({ from: 'not-a-date' })).toEqual(['from']);
    expect(propertiesWithErrors({ from: '' })).toEqual(['from']);
  });

  it('未指定なら検査しない（省略可能のまま）', () => {
    expect(propertiesWithErrors({})).toEqual([]);
  });
});
