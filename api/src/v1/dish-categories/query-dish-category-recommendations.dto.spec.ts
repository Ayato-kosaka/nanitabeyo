import 'reflect-metadata';
import { validate } from 'class-validator';
import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto/dish-categories/query-dish-category-recommendations.dto';

const createDto = (
  overrides: Partial<QueryDishCategoryRecommendationsDto> = {},
): QueryDishCategoryRecommendationsDto =>
  Object.assign(new QueryDishCategoryRecommendationsDto(), {
    address: 'country:JP, locality:Tokyo',
    languageTag: 'ja-JP',
    localLanguageCode: 'ja',
    ...overrides,
  });

describe('QueryDishCategoryRecommendationsDto', () => {
  it.each(['ja', 'en-AU', 'zh-Hans', 'zh-Hant-TW'])(
    'accepts languageTag %s emitted by the client locale provider',
    async (languageTag) => {
      const errors = await validate(createDto({ languageTag }));

      expect(errors).toHaveLength(0);
    },
  );

  it.each(['ja', 'zh-Hant', 'zh-Hant-TW'])(
    'accepts localLanguageCode %s emitted by reverse geocoding',
    async (localLanguageCode) => {
      const errors = await validate(createDto({ localLanguageCode }));

      expect(errors).toHaveLength(0);
    },
  );

  it('rejects a malformed language tag', async () => {
    const errors = await validate(createDto({ languageTag: 'not_a_locale' }));

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'languageTag' }),
      ]),
    );
  });
});
