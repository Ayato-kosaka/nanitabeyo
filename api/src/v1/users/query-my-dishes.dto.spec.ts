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

  it('sort=-sceneScore は sceneKey を必須にする', () => {
    expect(propertiesWithErrors({ sort: '-sceneScore' })).toEqual(['sceneKey']);
    expect(validate({ sort: '-sceneScore', sceneKey: 'date' }).errors).toEqual(
      [],
    );
  });

  it('sort=-timeSlotScore は timeSlotKey を必須にする', () => {
    expect(propertiesWithErrors({ sort: '-timeSlotScore' })).toEqual([
      'timeSlotKey',
    ]);
    expect(
      validate({ sort: '-timeSlotScore', timeSlotKey: 'dinner' }).errors,
    ).toEqual([]);
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
