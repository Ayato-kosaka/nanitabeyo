import { CreateDishMediaEntryService } from './create-dish-media-entry.service';
import { CreateDishMediaEntryJobPayload } from './create-dish-media-entry.interface';

describe('CreateDishMediaEntryService', () => {
  const mediaPath = 'production/google-maps/photo/test.jpg';
  let service: CreateDishMediaEntryService;
  let storage: {
    fileExists: jest.Mock;
    uploadFileAtPath: jest.Mock;
  };
  let dishesRepository: {
    isDishMediaCompleted: jest.Mock;
    createOrGetRestaurant: jest.Mock;
  };
  let cloudTasksService: { enqueueResizeImage: jest.Mock };

  const payload = {
    jobId: 'job-1',
    idempotencyKey: 'key-1',
    photoUri: ['https://example.com/photo.jpg'],
    dish_media: { id: 'media-1', media_path: mediaPath },
  } as unknown as CreateDishMediaEntryJobPayload;

  beforeEach(() => {
    storage = {
      fileExists: jest.fn(),
      uploadFileAtPath: jest.fn(),
    };
    dishesRepository = {
      isDishMediaCompleted: jest.fn().mockResolvedValue(false),
      createOrGetRestaurant: jest.fn(),
    };
    cloudTasksService = { enqueueResizeImage: jest.fn() };

    service = new CreateDishMediaEntryService(
      { withTransaction: jest.fn() } as never,
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

  it('does not skip a download unless the reused original still exists', async () => {
    storage.fileExists.mockResolvedValue(false);

    await expect(
      service.processAsyncJob({ ...payload, photoUri: [] }),
    ).rejects.toThrow(`Stored photo is missing: ${mediaPath}`);

    expect(dishesRepository.createOrGetRestaurant).not.toHaveBeenCalled();
    expect(cloudTasksService.enqueueResizeImage).not.toHaveBeenCalled();
  });
});
