import { CreateDishMediaEntryService } from './create-dish-media-entry.service';
import { CreateDishMediaEntryJobPayload } from './create-dish-media-entry.interface';

describe('CreateDishMediaEntryService', () => {
  const mediaPath = 'production/google-maps/photo/test.jpg';
  const stalePath = 'production/google-maps/photo/deleted.jpg';
  let service: CreateDishMediaEntryService;
  let storage: {
    fileExists: jest.Mock;
    uploadFileAtPath: jest.Mock;
  };
  let dishesRepository: {
    isDishMediaCompleted: jest.Mock;
    findRestaurantImagePathByGooglePlaceId: jest.Mock;
    createOrGetRestaurant: jest.Mock;
    createOrGetDishForCategory: jest.Mock;
    createDishMedia: jest.Mock;
    createDishReviews: jest.Mock;
  };
  let cloudTasksService: { enqueueResizeImage: jest.Mock };

  const payload = {
    jobId: 'job-1',
    idempotencyKey: 'key-1',
    photoUri: ['https://example.com/photo.jpg'],
    dish_media: { id: 'media-1', media_path: mediaPath },
  } as unknown as CreateDishMediaEntryJobPayload;

  /** #514 upsert まで通す用の完全な payload */
  const fullPayload = {
    jobId: 'job-1',
    idempotencyKey: 'key-1',
    photoUri: [],
    restaurants: {
      id: 'unknown',
      google_place_id: 'place-1',
      name: 'restaurant',
      name_language_code: 'ja',
      latitude: 0,
      longitude: 0,
      image_url: '',
      image_path: mediaPath,
      address_components: [],
      plus_code: null,
      created_at: '2026-08-13T00:00:00.000Z',
    },
    dishes: {
      id: 'unknown',
      restaurant_id: 'unknown',
      category_id: 'category-1',
      name: 'dish',
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
      lock_no: 0,
    },
    dish_media: {
      id: 'media-1',
      dish_id: 'unknown',
      user_id: null,
      media_path: mediaPath,
      media_type: 'image',
      thumbnail_path: mediaPath,
      media_processing_status: 'processing',
      thumbnail_processing_status: 'processing',
      video_duration_ms: null,
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
      lock_no: 0,
    },
    dish_reviews: [],
  } as unknown as CreateDishMediaEntryJobPayload;

  /** createOrGetRestaurant に渡された options を取り出す */
  const capturedUpdateImagePath = () =>
    dishesRepository.createOrGetRestaurant.mock.calls[0][3];

  beforeEach(() => {
    storage = {
      fileExists: jest.fn(),
      uploadFileAtPath: jest.fn(),
    };
    dishesRepository = {
      isDishMediaCompleted: jest.fn().mockResolvedValue(false),
      findRestaurantImagePathByGooglePlaceId: jest.fn(),
      createOrGetRestaurant: jest
        .fn()
        .mockResolvedValue({ id: 'restaurant-1', image_path: mediaPath }),
      createOrGetDishForCategory: jest.fn().mockResolvedValue({ id: 'dish-1' }),
      createDishMedia: jest.fn().mockResolvedValue({
        id: 'media-1',
        media_path: mediaPath,
        thumbnail_path: mediaPath,
        media_processing_status: 'processing',
        thumbnail_processing_status: 'processing',
      }),
      createDishReviews: jest.fn().mockResolvedValue([]),
    };
    cloudTasksService = {
      enqueueResizeImage: jest.fn().mockResolvedValue(undefined),
    };

    service = new CreateDishMediaEntryService(
      {
        withTransaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
      } as never,
      storage as never,
      {
        debug: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as never,
      dishesRepository as never,
      cloudTasksService as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails the job on a transient photo download error before writing DB rows', async () => {
    storage.fileExists.mockResolvedValue(false);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    await expect(service.processAsyncJob(payload)).rejects.toThrow(
      'Failed to download photo: 429',
    );

    expect(storage.uploadFileAtPath).not.toHaveBeenCalled();
    expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    expect(cloudTasksService.enqueueResizeImage).not.toHaveBeenCalled();
  });

  it('does not re-fetch an expired photoUri when the original is already stored', async () => {
    // 保存後に DB や enqueue で落ちた retry。photoUri は期限切れで叩けば必ず失敗する。
    storage.fileExists.mockResolvedValue(true);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);
    dishesRepository.findRestaurantImagePathByGooglePlaceId.mockResolvedValue({
      image_path: mediaPath,
    });

    await service.processAsyncJob({
      ...fullPayload,
      photoUri: ['https://example.com/expired.jpg'],
    } as CreateDishMediaEntryJobPayload);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dishesRepository.createOrGetRestaurant).toHaveBeenCalled();
    expect(cloudTasksService.enqueueResizeImage).toHaveBeenCalled();
  });

  it('does not skip a download unless the reused original still exists', async () => {
    storage.fileExists.mockResolvedValue(false);

    await expect(
      service.processAsyncJob({ ...payload, photoUri: [] }),
    ).rejects.toThrow(`Stored photo is missing: ${mediaPath}`);

    expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    expect(cloudTasksService.enqueueResizeImage).not.toHaveBeenCalled();
  });

  it('repairs a restaurant image path whose original is gone from GCS', async () => {
    // 1回目: 再利用する原本の存在確認 / 2回目: 既存 image_path の存在確認
    storage.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    dishesRepository.findRestaurantImagePathByGooglePlaceId.mockResolvedValue({
      image_path: stalePath,
    });

    await service.processAsyncJob(fullPayload);

    expect(storage.fileExists).toHaveBeenNthCalledWith(2, stalePath);
    expect(capturedUpdateImagePath()).toEqual({ updateImagePath: true });
  });

  it('leaves a restaurant image path alone while its original still exists', async () => {
    storage.fileExists.mockResolvedValue(true);
    dishesRepository.findRestaurantImagePathByGooglePlaceId.mockResolvedValue({
      image_path: stalePath,
    });

    await service.processAsyncJob(fullPayload);

    expect(capturedUpdateImagePath()).toEqual({ updateImagePath: false });
  });

  it('never adopts an image path that was not the verified original', async () => {
    storage.fileExists.mockResolvedValue(true);
    dishesRepository.findRestaurantImagePathByGooglePlaceId.mockResolvedValue({
      image_path: stalePath,
    });

    await service.processAsyncJob({
      ...fullPayload,
      restaurants: {
        ...fullPayload.restaurants,
        image_path: 'production/google-maps/photo/unverified.jpg',
      },
    } as CreateDishMediaEntryJobPayload);

    expect(
      dishesRepository.findRestaurantImagePathByGooglePlaceId,
    ).not.toHaveBeenCalled();
    expect(capturedUpdateImagePath()).toEqual({ updateImagePath: false });
  });
});
