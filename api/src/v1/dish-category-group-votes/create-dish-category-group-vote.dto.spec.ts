import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  CreateDishCategoryGroupVoteCandidateDto,
  CreateDishCategoryGroupVoteDto,
} from '@shared/v1/dto/dish-category-group-votes/create-dish-category-group-vote.dto';

describe('CreateDishCategoryGroupVoteCandidateDto', () => {
  it('accepts an empty tagline when recommendations have no localized reason', async () => {
    const dto = Object.assign(new CreateDishCategoryGroupVoteCandidateDto(), {
      dishCategoryId: 'Q282',
      displayName: 'Wine',
      tagline: '',
      imageUrl: 'https://example.com/wine.jpg',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('still rejects a non-string tagline', async () => {
    const dto = Object.assign(new CreateDishCategoryGroupVoteCandidateDto(), {
      dishCategoryId: 'Q282',
      displayName: 'Wine',
      tagline: null,
      imageUrl: 'https://example.com/wine.jpg',
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'tagline' }),
      ]),
    );
  });
});

/**
 * #1507 冪等キーの検証。
 *
 * 形式を UUID v4 に固定しておくと「リトライをまたいで同じ値か」を検証しやすく、
 * 任意文字列によるキー空間の汚染や極端に長い値を DTO 層で弾ける。
 * ただし **省略は許す**（キーを送らない旧クライアントを壊さない）。
 */
describe('CreateDishCategoryGroupVoteDto.idempotencyKey', () => {
  const baseDto = (idempotencyKey?: unknown) =>
    Object.assign(new CreateDishCategoryGroupVoteDto(), {
      searchContext: {
        location: { latitude: 35.658, longitude: 139.701 },
        radius: 800,
        priceLevels: [],
        localLanguageCode: 'ja',
      },
      candidates: [],
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

  const idempotencyKeyErrors = async (idempotencyKey?: unknown) =>
    (await validate(baseDto(idempotencyKey))).filter(
      (error) => error.property === 'idempotencyKey',
    );

  it('省略できる（冪等キーを送らない旧クライアントを壊さない）', async () => {
    expect(await idempotencyKeyErrors()).toHaveLength(0);
  });

  it('UUID v4 を受け付ける', async () => {
    expect(
      await idempotencyKeyErrors('3f8f6a4c-6f4e-4a1e-9a1a-6a4b2c1d0e5f'),
    ).toHaveLength(0);
  });

  it('UUID でない文字列を弾く', async () => {
    expect(await idempotencyKeyErrors('retry-1')).not.toHaveLength(0);
  });

  it('v4 以外の UUID を弾く（v1 は時刻とMACから決まるので再送の同一性を保証しない）', async () => {
    expect(
      await idempotencyKeyErrors('c232ab00-9414-11ec-b3c8-9e6bdeced846'),
    ).not.toHaveLength(0);
  });
});
