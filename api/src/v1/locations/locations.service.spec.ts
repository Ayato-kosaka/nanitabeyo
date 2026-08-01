// api/src/v1/locations/locations.service.spec.ts
//
// ❶ LocationsService の単体テスト
// ❷ addressComponents バリデーションの緩和条件をテスト
// ❸ shortText または longText のいずれか存在すればOK
//

import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

describe('LocationsService', () => {
  let service: LocationsService;
  let mockExternalApiService: jest.Mocked<ExternalApiService>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockLoggerService = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const mockExternalApi = {
      callPlaceDetails: jest.fn(),
      callReverseGeocoding: jest.fn(),
      callPlacesAutocomplete: jest.fn(),
      callPlaceSearchText: jest.fn(),
      getPhotoMedia: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: AppLoggerService,
          useValue: mockLoggerService,
        },
        {
          provide: ExternalApiService,
          useValue: mockExternalApi,
        },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    mockExternalApiService = module.get(ExternalApiService);
    mockLogger = module.get(AppLoggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLocationDetails', () => {
    const mockQuery = {
      placeId: 'ChIJ_example_place_id',
      languageCode: 'ja',
      sessionToken: 'test-session-token',
    };

    describe('addressComponents validation', () => {
      it('should accept components with only shortText', async () => {
        // #292 【テスト】shortText のみ存在するケース
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              types: ['country'],
            },
            {
              shortText: 'Oita',
              types: ['administrative_area_level_1'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should accept components with only longText', async () => {
        // #292 【テスト】longText のみ存在するケース（Google API で実際に発生）
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              longText: 'Japan',
              types: ['country'],
            },
            {
              longText: 'Oita Prefecture',
              types: ['administrative_area_level_1'],
            },
            {
              longText: 'Oita',
              types: ['locality'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should accept components with both shortText and longText', async () => {
        // #292 【テスト】shortText と longText 両方存在するケース
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              longText: 'Japan',
              types: ['country'],
            },
            {
              shortText: 'Oita',
              longText: 'Oita Prefecture',
              types: ['administrative_area_level_1'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should reject when all components have neither shortText nor longText', async () => {
        // #677 Test case where all components have no values (error expected)
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              types: ['country'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        await expect(service.getLocationDetails(mockQuery)).rejects.toThrow(
          'Invalid response from Google Places API: No usable address components',
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          'GooglePlacesDetailsCallError',
          'getLocationDetails',
          expect.any(Object),
        );
      });

      it('should accept components without types but with values', async () => {
        // #677 Test case where types field is missing but values exist (should succeed)
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2382, longitude: 131.6126 },
          viewport: {
            low: { latitude: 33.2, longitude: 131.6 },
            high: { latitude: 33.3, longitude: 131.7 },
          },
          addressComponents: [
            {
              shortText: 'JP',
              longText: 'Japan',
              types: ['country'],
            },
            {
              longText: '要町１−１',
              // types field missing (actual Google API response pattern)
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2382,
          longitude: 131.6126,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should handle mixed components with and without types', async () => {
        // #677 Test case for mixed components (some with types, some without)
        const mockResponse: protos.google.maps.places.v1.IPlace = {
          location: { latitude: 33.2326422, longitude: 131.60609739999998 },
          viewport: {
            low: { latitude: 33.2315705, longitude: 131.6051682 },
            high: { latitude: 33.2342685, longitude: 131.6078662 },
          },
          addressComponents: [
            {
              languageCode: 'ja',
              longText: '要町１−１',
              // types field missing
            },
            {
              languageCode: 'en',
              longText: 'Oita',
              shortText: 'Oita',
              types: ['locality', 'political'],
            },
            {
              languageCode: 'en',
              longText: 'Oita',
              shortText: 'Oita',
              types: ['administrative_area_level_1', 'political'],
            },
            {
              languageCode: 'en',
              longText: 'Japan',
              shortText: 'JP',
              types: ['country', 'political'],
            },
          ],
        };

        mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

        const result = await service.getLocationDetails(mockQuery);

        expect(result).toBeDefined();
        expect(result.location).toEqual({
          latitude: 33.2326422,
          longitude: 131.60609739999998,
        });
        expect(result.address).toContain('country:JP');
        expect(result.address).toContain('administrative_area_level_1:Oita');
        expect(result.address).toContain('locality:Oita');
        expect(result.localLanguageCode).toBe('ja');
        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    });

    describe('resolveLocalLanguageCode with longText fallback', () => {
      it('should resolve language code using shortText when available', () => {
        // #292 【テスト】shortText がある場合は優先して使用
        const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
          [
            {
              shortText: 'JP',
              longText: 'Japan',
              types: ['country'],
            },
          ];

        const result = service.resolveLocalLanguageCode(addressComponents);

        expect(result).toBe('ja');
      });

      it('should resolve language code using longText when shortText is missing', () => {
        // #292 【テスト】shortText がない場合は longText にフォールバック
        const addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[] =
          [
            {
              longText: 'JP',
              types: ['country'],
            },
          ];

        const result = service.resolveLocalLanguageCode(addressComponents);

        // longText に ISO コードがあれば正しく解決される
        expect(result).toBe('ja');
      });
    });
  });

  describe('address building with shortText/longText fallback', () => {
    const mockQuery = {
      placeId: 'ChIJ_example_place_id',
      languageCode: 'ja',
      sessionToken: 'test-session-token',
    };

    it('should build address using shortText when available', async () => {
      // #292 【テスト】shortText 優先で住所構築（public method 経由でテスト）
      const mockResponse: protos.google.maps.places.v1.IPlace = {
        location: { latitude: 33.2382, longitude: 131.6126 },
        viewport: {
          low: { latitude: 33.2, longitude: 131.6 },
          high: { latitude: 33.3, longitude: 131.7 },
        },
        addressComponents: [
          {
            shortText: 'JP',
            longText: 'Japan',
            types: ['country'],
          },
          {
            shortText: 'Oita',
            longText: 'Oita Prefecture',
            types: ['administrative_area_level_1'],
          },
          {
            shortText: 'Oita',
            longText: 'Oita City',
            types: ['locality'],
          },
        ],
      };

      mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

      const result = await service.getLocationDetails(mockQuery);

      expect(result).toBeDefined();
      expect(result.address).toContain('country:JP');
      expect(result.address).toContain('administrative_area_level_1:Oita');
      expect(result.address).toContain('locality:Oita');
    });

    it('should build address using longText when shortText is missing', async () => {
      // #292 【テスト】shortText がない場合は longText にフォールバック（public method 経由でテスト）
      const mockResponse: protos.google.maps.places.v1.IPlace = {
        location: { latitude: 33.2382, longitude: 131.6126 },
        viewport: {
          low: { latitude: 33.2, longitude: 131.6 },
          high: { latitude: 33.3, longitude: 131.7 },
        },
        addressComponents: [
          {
            longText: 'Japan',
            types: ['country'],
          },
          {
            longText: 'Oita Prefecture',
            types: ['administrative_area_level_1'],
          },
          {
            longText: 'Oita City',
            types: ['locality'],
          },
        ],
      };

      mockExternalApiService.callPlaceDetails.mockResolvedValue(mockResponse);

      const result = await service.getLocationDetails(mockQuery);

      expect(result).toBeDefined();
      expect(result.address).toContain('country:Japan');
      expect(result.address).toContain(
        'administrative_area_level_1:Oita Prefecture',
      );
      expect(result.address).toContain('locality:Oita City');
    });
  });

  describe('autocompleteLocations', () => {
    const mockQuery = {
      q: '渋谷駅',
      languageCode: 'ja',
      sessionToken: 'test-session-token',
    };

    /** Autocomplete (New) の suggestion 形式でモック候補を作る */
    const buildSuggestion = (
      placeId: string,
      mainText: string,
      secondaryText: string,
      types: string[],
    ) => ({
      placePrediction: {
        placeId,
        text: { text: `${mainText}、${secondaryText}` },
        structuredFormat: {
          mainText: { text: mainText },
          secondaryText: { text: secondaryText },
        },
        types,
      },
    });

    it('should dedupe same-name candidates keeping the establishment one', async () => {
      // #952 【テスト】渋谷駅が「駅(establishment)」と「番地レベル(geocode)」で重複するケース。
      // 関連度順では番地レベルが後だが、establishment が優先されて1件に畳まれること。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion('place-station', '渋谷駅', '日本、東京都渋谷区', [
            'train_station',
            'transit_station',
            'point_of_interest',
            'establishment',
          ]),
          buildSuggestion(
            'place-address',
            '渋谷駅',
            '日本、東京都渋谷区２丁目２４',
            ['geocode'],
          ),
          buildSuggestion(
            'place-mark-city',
            'マークシティ',
            '日本、東京都渋谷区',
            ['shopping_mall', 'establishment'],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(2);
      expect(result[0].place_id).toBe('place-station');
      expect(result[1].place_id).toBe('place-mark-city');
    });

    it('should prefer the establishment even when the address-level candidate comes first', async () => {
      // #952 【テスト】関連度順で番地レベルが先頭に来ても、駅(establishment)が残ること。
      // 返却順は先勝ちの位置(先頭)を維持する。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-address',
            '渋谷駅',
            '日本、東京都渋谷区２丁目２４',
            ['geocode'],
          ),
          buildSuggestion('place-station', '渋谷駅', '日本、東京都渋谷区', [
            'train_station',
            'establishment',
          ]),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0].place_id).toBe('place-station');
    });

    it('should keep distinct names untouched', async () => {
      // #952 【テスト】「渋谷駅」と「渋谷駅前」は別地点なので dedup 対象外であること
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion('place-station', '渋谷駅', '日本、東京都渋谷区', [
            'train_station',
            'establishment',
          ]),
          buildSuggestion('place-square', '渋谷駅前', '日本、東京都渋谷区', [
            'point_of_interest',
            'establishment',
          ]),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(2);
    });

    it('should dedupe full-width/half-width and spacing variants of the same name', async () => {
      // #952 【テスト】NFKC 正規化 + 空白除去により表記ゆれの同名も1件に畳まれること
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-1',
            'ＡＢＣマート 渋谷',
            '日本、東京都渋谷区',
            ['establishment'],
          ),
          buildSuggestion(
            'place-2',
            'ABCマート渋谷',
            '日本、東京都渋谷区２丁目',
            ['geocode'],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0].place_id).toBe('place-1');
    });

    it('should keep multiple same-name establishments (e.g. chain branches)', async () => {
      // #952 【テスト】PR #980 レビュー指摘: 同名チェーンの別店舗(establishment 同士、
      // place_id・secondaryText が異なる)は表示名が同じでも別地点なので全て残ること
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-sbux-1',
            'スターバックス',
            '日本、東京都渋谷区道玄坂',
            ['cafe', 'establishment'],
          ),
          buildSuggestion(
            'place-sbux-2',
            'スターバックス',
            '日本、東京都渋谷区宇田川町',
            ['cafe', 'establishment'],
          ),
          buildSuggestion(
            'place-sbux-addr',
            'スターバックス',
            '日本、東京都渋谷区２丁目',
            ['geocode'],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      // establishment 2店舗は残り、同名の番地レベル geocode だけが落ちる
      expect(result).toHaveLength(2);
      expect(result.map((place) => place.place_id)).toEqual([
        'place-sbux-1',
        'place-sbux-2',
      ]);
    });

    it('should keep non-establishment candidates when no same-name establishment exists', async () => {
      // #952 【テスト】同名の establishment が無い場合、住所系候補はそのまま残ること
      // (住所そのものを検索したいケースを壊さない)
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion('place-addr-1', '渋谷２丁目', '日本、東京都渋谷区', [
            'geocode',
          ]),
          buildSuggestion('place-town', '渋谷区', '日本、東京都', [
            'locality',
            'political',
            'geocode',
          ]),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(2);
    });

    it('should collapse exact duplicates (same mainText and secondaryText)', async () => {
      // #952 【テスト】表示が完全一致する候補は区別できないため1件に畳むこと
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion('place-dup-1', '渋谷駅', '日本、東京都渋谷区', [
            'train_station',
            'establishment',
          ]),
          buildSuggestion('place-dup-2', '渋谷駅', '日本、東京都渋谷区', [
            'transit_station',
            'establishment',
          ]),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0].place_id).toBe('place-dup-1');
    });
  });
});
