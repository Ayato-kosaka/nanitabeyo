import { Prisma } from '../../../../shared/prisma/client';
import { DishesRepository } from './dishes.repository';

describe('DishesRepository.createOrGetRestaurant', () => {
  const upsert = jest.fn();
  const tx = { restaurants: { upsert } } as unknown as Prisma.TransactionClient;
  const restaurant = {
    image_path: 'production/google-maps/photo/new.jpg',
    google_place_id: 'place-1',
  } as Prisma.restaurantsCreateInput;
  let repository: DishesRepository;

  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ id: 'restaurant-1' });
    repository = new DishesRepository(
      {} as never,
      { debug: jest.fn() } as never,
    );
  });

  it('updates only the image path after the handler has verified the original', async () => {
    await repository.createOrGetRestaurant(tx, restaurant, 'place-1', {
      updateImagePath: true,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { google_place_id: 'place-1' },
      update: { image_path: restaurant.image_path },
      create: restaurant,
    });
  });

  it('keeps the synchronous pre-handler upsert idempotent', async () => {
    await repository.createOrGetRestaurant(tx, restaurant, 'place-1');

    expect(upsert).toHaveBeenCalledWith({
      where: { google_place_id: 'place-1' },
      update: {},
      create: restaurant,
    });
  });
});
