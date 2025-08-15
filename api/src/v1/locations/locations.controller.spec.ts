// api/src/v1/locations/locations.controller.spec.ts
//
// Basic test for locations controller
//

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

describe('LocationsController', () => {
  let controller: LocationsController;
  let service: LocationsService;

  const mockLocationsService = {
    autocompleteLocations: jest.fn(),
    getLocationDetails: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
      ],
    }).compile();

    controller = module.get<LocationsController>(LocationsController);
    service = module.get<LocationsService>(LocationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('autocompleteLocations', () => {
    it('should call service.autocompleteLocations with session token', async () => {
      const query = {
        q: 'Tokyo',
        languageCode: 'en',
        sessionToken: 'test-session-token',
      };
      const expectedResult = [
        {
          place_id: 'ChIJ51cu8IcbXWARiRtXIothAS4',
          text: 'Tokyo, Japan',
          mainText: 'Tokyo',
          secondaryText: 'Japan',
          types: ['locality', 'political'],
        },
      ];

      mockLocationsService.autocompleteLocations.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.autocompleteLocations(query);

      expect(service.autocompleteLocations).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });

    it('should call service.autocompleteLocations without session token', async () => {
      const query = {
        q: 'Tokyo',
        languageCode: 'en',
      };
      const expectedResult = [
        {
          place_id: 'ChIJ51cu8IcbXWARiRtXIothAS4',
          text: 'Tokyo, Japan',
          mainText: 'Tokyo',
          secondaryText: 'Japan',
          types: ['locality', 'political'],
        },
      ];

      mockLocationsService.autocompleteLocations.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.autocompleteLocations(query);

      expect(service.autocompleteLocations).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getLocationDetails', () => {
    it('should call service.getLocationDetails', async () => {
      const query = {
        placeId: 'ChIJ51cu8IcbXWARiRtXIothAS4',
        languageCode: 'en',
        sessionToken: 'test-session-token',
      };
      const expectedResult = {
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
        viewport: {
          low: {
            latitude: 35.617,
            longitude: 139.5703,
          },
          high: {
            latitude: 35.7354,
            longitude: 139.7303,
          },
        },
        address: 'Tokyo, Japan',
        regionCode: 'JP',
      };

      mockLocationsService.getLocationDetails.mockResolvedValue(expectedResult);

      const result = await controller.getLocationDetails(query);

      expect(service.getLocationDetails).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });

    it('should call service.getLocationDetails without session token', async () => {
      const query = {
        placeId: 'ChIJ51cu8IcbXWARiRtXIothAS4',
        languageCode: 'en',
      };
      const expectedResult = {
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
        viewport: {
          low: {
            latitude: 35.617,
            longitude: 139.5703,
          },
          high: {
            latitude: 35.7354,
            longitude: 139.7303,
          },
        },
        address: 'Tokyo, Japan',
        regionCode: 'JP',
      };

      mockLocationsService.getLocationDetails.mockResolvedValue(expectedResult);

      const result = await controller.getLocationDetails(query);

      expect(service.getLocationDetails).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });
});
