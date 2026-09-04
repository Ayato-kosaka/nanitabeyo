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

    describe('resolveLocalLanguageCode with malformed DB values', () => {
      // #843 restaurants.address_components は jsonb NOT NULL だが、jsonb の
      // NOT NULL は JSON リテラルの null も {} も防がない。dishes.service は
      // この列を `as` キャストだけで渡してくるため、配列でない値が来ても
      // 500 にならず 'en' へフォールバックすることを固定する。
      it.each([
        ['空配列', []],
        ['null', null],
        ['undefined', undefined],
        ['JSONオブジェクト', { country: 'JP' }],
        ['文字列', 'JP'],
      ])('%s を渡しても例外を投げず en を返す', (_label, value) => {
        const result = service.resolveLocalLanguageCode(
          value as unknown as protos.google.maps.places.v1.Place.IAddressComponent[],
        );

        expect(result).toBe('en');
      });

      it('要素が null 混じりでも国コードを取り出せる', () => {
        const addressComponents = [
          null,
          { shortText: 'JP', longText: 'Japan', types: ['country'] },
        ];

        const result = service.resolveLocalLanguageCode(
          addressComponents as unknown as protos.google.maps.places.v1.Place.IAddressComponent[],
        );

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

    /**
     * Autocomplete (New) の suggestion 形式でモック候補を作る。
     *
     * ⚠️ #1673 `text` は **secondaryText が先・mainText が後**である。
     * Google Autocomplete は languageCode: ja では日本語の住所順で text を返す
     * (mainText「渋谷駅」/ secondaryText「日本、東京都渋谷区」→ text「日本、東京都渋谷区 渋谷駅」)。
     * ここを逆順(`mainText、secondaryText`)で作っていたため、#1502 が text を画面表示に
     * 使ったときの「主たる地名が末尾へ回る」現象を、どの検証でも観測できなかった。
     */
    const buildSuggestion = (
      placeId: string,
      mainText: string,
      secondaryText: string,
      types: string[],
    ) => ({
      placePrediction: {
        placeId,
        text: { text: `${secondaryText} ${mainText}` },
        structuredFormat: {
          mainText: { text: mainText },
          secondaryText: { text: secondaryText },
        },
        types,
      },
    });

    it('should keep same-name candidates that differ in secondaryText', async () => {
      // #1176 【テスト】表示名が同じでも secondaryText が違えば別地点として区別できる。
      // かつての #952 ルール2 は「同名の establishment がいれば非 establishment を落とす」
      // だったが、地理的な絞り込みが無い以上その前提は成立しない。全件残すこと。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion('place-station', '渋谷駅', '日本、東京都渋谷区', [
            'train_station',
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

      expect(result.map((place) => place.place_id)).toEqual([
        'place-station',
        'place-address',
        'place-mark-city',
      ]);
    });

    it('should keep same-name stations in different prefectures', async () => {
      // #1176 【テスト】これがこの変更の主目的。日本には同名の別駅が実在する。
      // 名前ベースで畳むと、明石の大久保駅を選びたいユーザーが選択不能になる。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-okubo-tokyo',
            '大久保駅',
            '日本、東京都新宿区百人町',
            [
              'train_station',
              'transit_station',
              'transportation_service',
              'point_of_interest',
              'establishment',
            ],
          ),
          buildSuggestion(
            'place-okubo-hyogo',
            '大久保駅',
            '日本、兵庫県明石市大久保町',
            [
              'train_station',
              'transit_station',
              'transportation_service',
              'point_of_interest',
              'establishment',
            ],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result.map((place) => place.place_id)).toEqual([
        'place-okubo-tokyo',
        'place-okubo-hyogo',
      ]);
    });

    it('should keep the granularity duplicates of the same station', async () => {
      // #1176 【テスト】#1123 で畳んでいた「同一駅の粒度違い重複」も、今後は残す。
      // これは意図的な譲歩である: 重複表示のわずらわしさより、
      // 別地点が選択不能になる方が損害が大きい(#1176)。
      // types は development 実環境の実測値(Issue #1123 の検証コメント)。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'ChIJz8MVLFiLGGARXP0DqqhoDow',
            '渋谷駅',
            '日本、東京都渋谷区',
            [
              'point_of_interest',
              'transportation_service',
              'establishment',
              'transit_station',
            ],
          ),
          buildSuggestion(
            'ChIJnxAAO1aLGGARJqvi8d4oczM',
            '渋谷駅',
            '日本、東京都渋谷区渋谷２丁目２４',
            [
              'transportation_service',
              'point_of_interest',
              'train_station',
              'transit_station',
              'establishment',
              'subway_station',
            ],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result.map((place) => place.place_id)).toEqual([
        'ChIJz8MVLFiLGGARXP0DqqhoDow',
        'ChIJnxAAO1aLGGARJqvi8d4oczM',
      ]);
    });

    it('should keep distinct names untouched', async () => {
      // 「渋谷駅」と「渋谷駅前」は別地点なので当然残る。
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

    it('should keep same-name bus stops', async () => {
      // #1176 【テスト】同名の別バス停(進行方向・のりば違い)が残ること。
      // 以前は deny-list(bus_station 等)で守っていたが、実環境には
      // types が establishment / point_of_interest だけのバス停が存在し
      // (八景島駅前 バス停)、type ベースの保護では守り切れなかった。
      // 名前で畳まなくなったため、type に依存せず守られる。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-bus-a',
            '市役所前',
            '日本、福岡県久留米市中央町',
            [
              'bus_stop',
              'transit_station',
              'point_of_interest',
              'establishment',
            ],
          ),
          buildSuggestion('place-bus-b', '市役所前', '日本、福岡県柳川市本町', [
            'bus_stop',
            'transit_station',
            'point_of_interest',
            'establishment',
          ]),
          buildSuggestion(
            'place-bus-no-type-a',
            '八景島駅前 バス停',
            '日本、神奈川県横浜市金沢区海の公園１０',
            ['establishment', 'point_of_interest'],
          ),
          buildSuggestion(
            'place-bus-no-type-b',
            '八景島駅前 バス停',
            '日本、神奈川県横浜市金沢区海の公園４０',
            ['establishment', 'point_of_interest'],
          ),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result.map((place) => place.place_id)).toEqual([
        'place-bus-a',
        'place-bus-b',
        'place-bus-no-type-a',
        'place-bus-no-type-b',
      ]);
    });

    it('should keep multiple same-name establishments (e.g. chain branches)', async () => {
      // 同名チェーンの別店舗はもともと残す仕様。回帰させないこと。
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
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(2);
    });

    it('should collapse exact duplicates even with full-width/spacing variants', async () => {
      // #1176 【テスト】残した唯一の畳み込み(ルール2)は NFKC 正規化 + 空白除去を経ること。
      // mainText と secondaryText の両方が一致するので UI 上まったく区別が付かない。
      mockExternalApiService.callPlacesAutocomplete.mockResolvedValue({
        suggestions: [
          buildSuggestion(
            'place-1',
            'ＡＢＣマート 渋谷',
            '日本、東京都渋谷区',
            ['establishment'],
          ),
          buildSuggestion('place-2', 'ABCマート渋谷', '日本、東京都渋谷区', [
            'establishment',
          ]),
        ],
      } as never);

      const result = await service.autocompleteLocations(mockQuery);

      expect(result).toHaveLength(1);
      expect(result[0].place_id).toBe('place-1');
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
