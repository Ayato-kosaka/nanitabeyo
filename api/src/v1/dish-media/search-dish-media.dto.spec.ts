import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchDishMediaDto } from '@shared/v1/dto/dish-media/search-dish-media.dto';

/**
 * #817 `preferredLanguageCodes` は GET のクエリ文字列として届く。
 *
 * app-expo 側の `toQueryString`（app-expo/lib/fetchWithAuth.ts）は値を `String(v)` で
 * 文字列化するため、配列 `["ja", "en"]` は `"ja,en"` というカンマ区切りになる。
 * ここが DTO の @Transform と噛み合わないと、検索が 400 になるか優先指定が無効化される。
 * そのシリアライズ契約をテストで固定する。
 */
const createDto = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(SearchDishMediaDto, {
    location: '35.68944,139.69167',
    radius: 1000,
    categoryId: 'category-1',
    ...overrides,
  });

describe('SearchDishMediaDto.preferredLanguageCodes', () => {
  it('app-expo が送るカンマ区切り文字列を配列として受け取る', async () => {
    const dto = createDto({ preferredLanguageCodes: 'ja,en' });

    expect(dto.preferredLanguageCodes).toEqual(['ja', 'en']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('1 件だけの場合も配列になる', async () => {
    const dto = createDto({ preferredLanguageCodes: 'ja' });

    expect(dto.preferredLanguageCodes).toEqual(['ja']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('配列がそのまま届いても受け取れる', async () => {
    const dto = createDto({ preferredLanguageCodes: ['ja', 'zh-Hant'] });

    expect(dto.preferredLanguageCodes).toEqual(['ja', 'zh-Hant']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('未指定でも通る（後方互換）', async () => {
    const dto = createDto();

    expect(dto.preferredLanguageCodes).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    'ja',
    'en',
    'zh-Hans',
    'zh-Hant',
    'zh-Hant-TW',
    'fil',
    'ja-JP', // UGC 側の保存値形式
  ])('reverse geocoding / locale が生成しうる %s を通す', async (code) => {
    const dto = createDto({ preferredLanguageCodes: code });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['japanese', 'not_a_locale', 'j'])(
    '不正な言語タグ %s は弾く',
    async (code) => {
      const dto = createDto({ preferredLanguageCodes: code });
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('preferredLanguageCodes');
    },
  );

  it('カンマ区切りの一部が不正なら弾く', async () => {
    const dto = createDto({ preferredLanguageCodes: 'ja,not_a_locale' });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('件数の上限を超えたら弾く', async () => {
    const dto = createDto({ preferredLanguageCodes: 'ja,en,fr,ko,es,de' });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

/**
 * #288 timeSlot は「選んだ時間帯に営業しているか」フィルタの入力になる。
 * 未指定は既存クライアント互換のため許可し、それ以外は
 * `morning|lunch|dinner|late_night` の4値だけを許可する。
 */
describe('SearchDishMediaDto.timeSlot', () => {
  it.each(['morning', 'lunch', 'dinner', 'late_night'])('%s を通す', async (timeSlot) => {
    const dto = createDto({ timeSlot });

    expect(dto.timeSlot).toBe(timeSlot);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('未指定でも通る（後方互換。除外・加点なしとして扱われる）', async () => {
    const dto = createDto();

    expect(dto.timeSlot).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['breakfast', 'night', ''])('4値以外の %s は弾く', async (timeSlot) => {
    const dto = createDto({ timeSlot });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('timeSlot');
  });
});
