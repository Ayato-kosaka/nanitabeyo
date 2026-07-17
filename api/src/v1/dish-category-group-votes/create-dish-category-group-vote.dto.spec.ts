import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateDishCategoryGroupVoteCandidateDto } from '@shared/v1/dto/dish-category-group-votes/create-dish-category-group-vote.dto';

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
