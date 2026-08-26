import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateDishReviewDto } from '@shared/v1/dto/dish-reviews/create-dish-review.dto';
import { CreateDishMediaReviewDto } from '@shared/v1/dto/dish-media/create-dish-media.dto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #1599 `currencyCode` は DB 側が `currency_code CHAR(3)`。
 *
 * DTO が `@IsString()` だけだったので、
 *  - 4 文字以上 → Postgres が `value too long for type character(3)` で落ち、**500**
 *  - 3 文字未満 → 空白で右詰めされて**黙って保存**される
 *
 * どちらもユーザー入力に対する応答としては誤り。境界で 400 にする。
 */
const errorsFor = (
  Dto: typeof CreateDishReviewDto,
  currencyCode: unknown,
): string[] => {
  const dto = plainToInstance(Dto, {
    dishId: '11111111-1111-4111-8111-111111111111',
    comment: 'おいしい',
    languageCode: 'ja',
    rating: 5,
    currencyCode,
  });
  return validateSync(dto)
    .map((e) => e.property)
    .sort();
};

describe('#1599 currencyCode は英字 3 文字だけ通す', () => {
  it.each(['JPY', 'USD', 'EUR', 'jpy'])('%s は通る', (code) => {
    expect(errorsFor(CreateDishReviewDto, code)).not.toContain('currencyCode');
  });

  it.each([
    ['JPYY', '4 文字。CHAR(3) に入らず 500 になっていた'],
    ['J', '1 文字。空白で右詰めされて黙って保存されていた'],
    ['JP', '2 文字。同上'],
    ['12345', '数字'],
    ['J$Y', '記号'],
    ['', '空文字'],
  ])('%s は弾く（%s）', (code) => {
    expect(errorsFor(CreateDishReviewDto, code)).toContain('currencyCode');
  });

  it('未指定なら検査しない（省略可能のまま）', () => {
    expect(errorsFor(CreateDishReviewDto, undefined)).not.toContain(
      'currencyCode',
    );
  });

  it('dish-media 側の同じ項目にも同じ検査が掛かっている', () => {
    const build = (currencyCode: unknown) =>
      validateSync(
        plainToInstance(CreateDishMediaReviewDto, {
          comment: 'おいしい',
          rating: 5,
          currencyCode,
        }),
      )
        .map((e) => e.property)
        .sort();

    expect(build('JPY')).not.toContain('currencyCode');
    expect(build('JPYY')).toContain('currencyCode');
  });

  /**
   * ⚠️ ここが本命。`@IsISO4217CurrencyCode()` へ «改善» したくなるが、
   * class-validator の一覧は古く、**アプリ自身が送りうる ZWG
   * （ジンバブエ・ゴールド、2024 年導入）を弾いてしまう**。
   * 通貨の一覧を 2 箇所で持つとずれるので、形だけを見る方針を固定する。
   */
  it('アプリが実際に送りうる通貨コードを 1 つも弾かない', () => {
    // 対応表は app-expo 側にあり、expo 依存を引くので import できない。
    // **一覧をここへ書き写すと必ずずれる**ので、正本のソースから読み取る。
    // 対応通貨が増えたときに、この検査が «その通貨は弾かれる» と教えてくれる。
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app-expo', 'lib', 'googlePlaces.ts'),
      'utf8',
    );
    const start = source.indexOf('export const COUNTRY_TO_CURRENCY_MAP');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('} as const', start));

    const codes = [...new Set(block.match(/:\s*"([A-Z]{3})"/g) ?? [])].map(
      (m) => m.replace(/[:\s"]/g, ''),
    );
    // 走査が壊れていたら 0 件で «全部通った» ように見えるので、件数も固定する
    expect(codes.length).toBeGreaterThan(100);
    // 2024 年導入の新しい通貨。class-validator の ISO-4217 一覧はこれを知らない
    expect(codes).toContain('ZWG');

    const rejected = codes.filter((code) =>
      errorsFor(CreateDishReviewDto, code).includes('currencyCode'),
    );

    expect(rejected).toEqual([]);
  });
});
