// api/src/v1/locations/locations.service.ts
//
// ❶ Google Places API との連携サービス
// ❷ Text Search API, Place Details API, Photo Media API を使用してレストラン情報を取得
// ❸ Autocomplete API を使用して地名候補を取得
//

import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  AutocompleteLocationsResponse,
  LocationDetailsResponse,
  LocationReverseGeocodingResponse,
} from '@shared/v1/res';
import { google } from '@googlemaps/places/build/protos/protos';
import {
  QueryAutocompleteLocationsDto,
  QueryLocationDetailsDto,
  QueryReverseGeocodingDto,
} from '@shared/v1/dto';
import { ExternalApiService } from 'src/core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

// Import language dictionaries
import * as territoryLanguages from './territory_languages.json';
import * as subterritoryOverrides from './subterritory_overrides.json';

// Interface definitions for language dictionaries
interface TerritoryLanguage {
  territory: string;
  lang: string;
  weight: number;
  script: string;
  notes: string;
}

interface SubterritoryOverride {
  sub: string;
  primary_lang: string;
  script: string;
  fallback_list: string[];
}

interface PhotoCandidate {
  name?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
}

export type PhotoMediaJson = { photoUri: string };
export type PhotoMediaBinary = {
  buffer: Buffer;
  contentType: string;
  byteLength: number;
};

@Injectable()
export class LocationsService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly externalApiService: ExternalApiService,
  ) {}

  /**
   * addressComponents から国コード (ISO-2) と州コード (ISO-3166-2) を抽出
   */
  private extractLocationCodes(
    addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[],
  ): {
    countryCode: string | null;
    subterritoryCode: string | null;
  } {
    // #843 呼び出し元の一つ（dishes.service.createOrGetDish）は DB の
    // restaurants.address_components を `as` キャストだけで渡してくる。この列は
    // jsonb NOT NULL だが、jsonb の NOT NULL は JSON リテラルの null も `{}` も
    // 防がないため、配列である保証がない。配列でない値が来ると
    // `addressComponents.find is not a function` で POST /v1/dishes が 500 になる。
    // Google API 由来の呼び出し元は手前で存在チェックしているが、DB 由来の経路には
    // それが無い。フロント側（app-expo/lib/googlePlaces.ts）には同じガードがある。
    const components = Array.isArray(addressComponents) ? addressComponents : [];
    const countryComponent = components.find((component) =>
      component?.types?.includes('country'),
    );
    const adminLevel1Component = components.find((component) =>
      component?.types?.includes('administrative_area_level_1'),
    );

    // #677 【設計】shortText または longText のいずれか存在すればOKとする（Google API 仕様で shortText 欠損パターンがあるため）
    // #677 【注意】ISO-3166-2 形式では shortText が望ましい（2文字コード）。longText は補完用。
    const countryCode =
      countryComponent?.shortText || countryComponent?.longText || null;
    let subterritoryCode: string | null = null;

    // ISO-3166-2 形式では shortText を優先（2文字コード）
    const adminLevel1Code = adminLevel1Component?.shortText;
    if (countryCode && adminLevel1Code) {
      // ISO-3166-2 形式 (例: CH-GE, ES-CT) に変換
      subterritoryCode = `${countryCode}-${adminLevel1Code}`;
    }

    return { countryCode, subterritoryCode };
  }

  /**
   * 言語候補リストを生成（州上書き → 国レベル → 英語フォールバック）
   */
  private buildLanguageCandidates(
    countryCode: string,
    subterritoryCode: string | null,
  ): string[] {
    const candidates: string[] = [];

    // 1. 州/県での上書きを最優先
    if (subterritoryCode) {
      const override = (subterritoryOverrides as SubterritoryOverride[]).find(
        (item) => item.sub === subterritoryCode,
      );
      if (override) {
        candidates.push(override.primary_lang);
        if (override.fallback_list?.length > 0) {
          candidates.push(...override.fallback_list);
        }
      }
    }

    // 2. 国の重み順を後ろに追加（重複排除）
    const territoryLangs = (territoryLanguages as TerritoryLanguage[])
      .filter((item) => item.territory === countryCode)
      .sort((a, b) => b.weight - a.weight);

    for (const item of territoryLangs) {
      const langCode = item.script ? `${item.lang}-${item.script}` : item.lang;
      if (!candidates.includes(langCode)) {
        candidates.push(langCode);
      }
    }

    // 3. 最後に英語フォールバック
    if (!candidates.includes('en')) {
      candidates.push('en');
    }

    return candidates;
  }

  /**
   * addressComponents から最適な言語コードを解決
   */
  resolveLocalLanguageCode(
    addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[],
  ): string {
    const { countryCode, subterritoryCode } =
      this.extractLocationCodes(addressComponents);

    if (!countryCode) {
      this.logger.warn('CountryCodeNotFound', 'resolveLocalLanguageCode', {
        addressComponents,
      });
      return 'en'; // フォールバック
    }

    const candidates = this.buildLanguageCandidates(
      countryCode,
      subterritoryCode,
    );

    this.logger.debug('LanguageResolution', 'resolveLocalLanguageCode', {
      countryCode,
      subterritoryCode,
      candidates,
    });

    // 最初の候補を採用
    return candidates[0] || 'en';
  }

  /**
   * Google Maps Text Search API を使用してレストランを検索
   */
  async searchRestaurants(params: {
    location: string;
    radius: number;
    dishCategoryName: string;
    minRating?: number;
    languageCode?: string;
    priceLevels?: string[];
    pageSize?: number;
  }): Promise<google.maps.places.v1.ISearchTextResponse> {
    const [lat, lng] = params.location.split(',').map(Number);

    this.logger.debug('GoogleMapsTextSearch', 'searchRestaurants', params);

    // カテゴリに基づく検索クエリを構築
    const query = params.dishCategoryName;

    // Build the base request payload
    const baseRequestPayload: protos.google.maps.places.v1.ISearchTextRequest =
      {
        textQuery: query,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: params.radius,
          },
        },
        ...(params.pageSize && { pageSize: params.pageSize }),
        ...(params.languageCode && { languageCode: params.languageCode }),
      };

    // Helper function to perform search with given parameters
    const performSearch = async (
      requestPayload: protos.google.maps.places.v1.ISearchTextRequest,
      searchAttempt: string,
    ): Promise<google.maps.places.v1.ISearchTextResponse> => {
      try {
        this.logger.debug('GoogleMapsTextSearchAttempt', 'searchRestaurants', {
          attempt: searchAttempt,
          hasMinRating: 'minRating' in requestPayload,
          hasPriceLevels: 'priceLevels' in requestPayload,
          hasRankPreference: 'rankPreference' in requestPayload,
        });

        const response = await this.externalApiService.callPlaceSearchText(
          [
            'places.id',
            'places.displayName',
            'places.location',
            'places.addressComponents',
            'places.plusCode',
            'places.photos.name', // #636 【バグ】contextualContents が返らない場合のフォールバック用
            'places.photos.widthPx',
            'places.photos.heightPx',
            'places.reviews.originalText', // #636 【バグ】contextualContents が返らない場合のフォールバック用
            'places.reviews.rating',
            'places.reviews.authorAttribution',
            'contextualContents.photos.name',
            'contextualContents.photos.widthPx',
            'contextualContents.photos.heightPx',
            'contextualContents.reviews.originalText',
            'contextualContents.reviews.rating',
            'contextualContents.reviews.authorAttribution',
          ].join(','),
          requestPayload,
        );

        if (response.places && response.places.length > 0) {
          this.logger.debug(
            'GoogleMapsTextSearchSuccess',
            'searchRestaurants',
            {
              resultCount: response.places?.length,
              searchAttempt,
            },
          );
          return response;
        }

        this.logger.debug(
          'GoogleMapsTextSearchNoResults',
          'searchRestaurants',
          {
            resultCount: 0,
            searchAttempt,
          },
        );
        return {};
      } catch (error) {
        this.logger.error('GoogleMapsAPICallError', 'searchRestaurants', {
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          location: params.location,
          radius: params.radius,
          category: params.dishCategoryName,
          searchAttempt,
        });
        throw error;
      }
    };

    try {
      // Step 1: Normal search with all conditions
      const fullRequestPayload: protos.google.maps.places.v1.ISearchTextRequest =
        {
          ...baseRequestPayload,
          ...(params.minRating && { minRating: params.minRating }),
          // priceLevels は string 配列なので、型チェックを回避するためにキャスト
          ...(params.priceLevels && {
            priceLevels: params.priceLevels.map(
              (level) =>
                level as unknown as protos.google.maps.places.v1.PriceLevel,
            ),
          }),
          rankPreference: 'DISTANCE',
        };

      let response = await performSearch(fullRequestPayload, 'full_conditions');

      if (response.places && response.places.length > 0) {
        return response;
      }

      // Step 2: Retry without minRating and priceLevels if no results
      this.logger.warn('GoogleMapsTextSearchFallback', 'searchRestaurants', {
        message:
          'No results with full conditions, retrying without minRating and priceLevels',
        originalParams: params,
      });

      const relaxedRequestPayload: protos.google.maps.places.v1.ISearchTextRequest =
        {
          ...baseRequestPayload,
          rankPreference: 'DISTANCE',
        };

      response = await performSearch(
        relaxedRequestPayload,
        'without_rating_and_price',
      );

      if (response.places && response.places.length > 0) {
        return response;
      }

      // Step 3: Final attempt without rankPreference
      this.logger.warn(
        'GoogleMapsTextSearchFinalFallback',
        'searchRestaurants',
        {
          message:
            'No results with relaxed conditions, retrying without rankPreference',
          originalParams: params,
        },
      );

      const minimalRequestPayload: protos.google.maps.places.v1.ISearchTextRequest =
        {
          ...baseRequestPayload,
        };

      response = await performSearch(
        minimalRequestPayload,
        'minimal_conditions',
      );

      if (!response.places || response.places.length === 0) {
        this.logger.warn(
          'GoogleMapsTextSearchAllFallbacksFailed',
          'searchRestaurants',
          {
            message: 'All search attempts returned 0 results',
            originalParams: params,
          },
        );
      }

      return response;
    } catch (error) {
      this.logger.error('GoogleMapsAPICallError', 'searchRestaurants', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        location: params.location,
        radius: params.radius,
        category: params.dishCategoryName,
      });

      throw error;
    }
  }

  /**
   * 写真候補を選択する優先順位ロジック
   */
  private selectBestPhoto(photos: PhotoCandidate[]): PhotoCandidate | null {
    if (!photos || photos.length === 0) {
      return null;
    }

    // フィルタリングとソート
    const validPhotos = photos.filter(
      (photo) => photo.name && photo.widthPx && photo.heightPx,
    );

    if (validPhotos.length === 0) {
      // フォールバック: 名前のある最初の写真を使用
      return photos.find((photo) => photo.name) || null;
    }

    // 優先順位ロジック
    const sortedPhotos = validPhotos.sort((a, b) => {
      // ① widthPx > 600 を満たすものを優先
      const aWideEnough = (a.widthPx || 0) > 600;
      const bWideEnough = (b.widthPx || 0) > 600;

      if (aWideEnough && !bWideEnough) return -1;
      if (!aWideEnough && bWideEnough) return 1;

      // ② アスペクト比が 9:16 に近いもの（差の小さい順）
      const targetRatio = 9 / 16;
      const aRatio = (a.widthPx || 1) / (a.heightPx || 1);
      const bRatio = (b.widthPx || 1) / (b.heightPx || 1);
      const aDiff = Math.abs(aRatio - targetRatio);
      const bDiff = Math.abs(bRatio - targetRatio);

      if (Math.abs(aDiff - bDiff) > 0.01) {
        return aDiff - bDiff;
      }

      // ③ widthPx の大きい順
      return (b.widthPx || 0) - (a.widthPx || 0);
    });

    return sortedPhotos[0] || validPhotos[0];
  }

  /**
   * 複数の写真候補から成功するまで順次試行
   */
  async tryGetPhotoMedia(
    photos: PhotoCandidate[],
    skipHttpRedirect?: true,
  ): Promise<PhotoMediaJson | null>;
  async tryGetPhotoMedia(
    photos: PhotoCandidate[],
    skipHttpRedirect: false,
  ): Promise<PhotoMediaBinary | null>;
  async tryGetPhotoMedia(
    photos: PhotoCandidate[],
    skipHttpRedirect = true,
  ): Promise<PhotoMediaJson | PhotoMediaBinary | null> {
    if (!photos || photos.length === 0) {
      return null;
    }

    // 優先順位に基づいて写真を選択・ソート
    const allCandidates = [...photos];
    const bestPhoto = this.selectBestPhoto(allCandidates);

    if (bestPhoto) {
      // ベスト写真を最初に移動
      const otherPhotos = allCandidates.filter(
        (p) => p.name !== bestPhoto.name,
      );
      allCandidates.splice(0, allCandidates.length, bestPhoto, ...otherPhotos);
    }

    // 順次試行
    for (const photo of allCandidates) {
      if (!photo.name) continue;

      try {
        const result = await this.externalApiService.getPhotoMedia(
          photo.name,
          photo.widthPx || undefined, // #429 API の仕様により、そのままのサイズを指定する。
          photo.heightPx || undefined,
          { skipHttpRedirect },
        );

        if (result) {
          this.logger.debug('PhotoMediaSuccess', 'tryGetPhotoMedia', {
            photoName: photo.name,
            widthPx: photo.widthPx,
            heightPx: photo.heightPx,
          });
          return result;
        } else throw new Error('No photo media returned');
      } catch (error) {
        this.logger.warn('PhotoMediaFallback', 'tryGetPhotoMedia', {
          photoName: photo.name,
          widthPx: photo.widthPx,
          heightPx: photo.heightPx,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 次の候補を試行
        continue;
      }
    }

    return null;
  }

  /**
   * 写真URIから実際のバイナリデータをダウンロード（非同期ジョブ用）
   */
  async downloadPhotoData(photoUri: string): Promise<{ data: Buffer }> {
    try {
      // Google Maps Photo API から実際のバイナリデータを取得
      // 注: 実際の実装では HTTP クライアントを使用して photoUri から画像をダウンロード
      const response = await fetch(photoUri);
      if (!response.ok) {
        throw new Error(`Failed to download photo: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      this.logger.debug('PhotoDataDownloaded', 'downloadPhotoData', {
        photoUri,
        dataSize: buffer.length,
      });

      return { data: buffer };
    } catch (error) {
      this.logger.error('PhotoDataDownloadError', 'downloadPhotoData', {
        photoUri,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Google Places API Autocomplete を使用して地名候補を取得
   */
  async autocompleteLocations(
    query: QueryAutocompleteLocationsDto,
  ): Promise<AutocompleteLocationsResponse> {
    const requestPayload = {
      input: query.q,
      languageCode: query.languageCode,
      sessionToken: query.sessionToken,
    };

    try {
      const fieldMask =
        'suggestions.placePrediction.placeId,' +
        'suggestions.placePrediction.text,' +
        'suggestions.placePrediction.structuredFormat.mainText,' +
        'suggestions.placePrediction.structuredFormat.secondaryText,' +
        'suggestions.placePrediction.types';

      const response = await this.externalApiService.callPlacesAutocomplete(
        fieldMask,
        requestPayload,
      );

      const places = response.suggestions
        ?.map((suggestion) => ({
          place_id: suggestion.placePrediction?.placeId ?? '',
          text: suggestion.placePrediction?.text?.text ?? '',
          mainText:
            suggestion.placePrediction?.structuredFormat?.mainText?.text ?? '',
          secondaryText:
            suggestion.placePrediction?.structuredFormat?.secondaryText?.text ??
            '',
          types: suggestion.placePrediction?.types || [],
        }))
        .filter(
          (place) =>
            place.place_id !== '' &&
            place.text !== '' &&
            place.mainText !== '' &&
            place.secondaryText !== '',
        );

      if (!places) {
        this.logger.debug(
          'AutocompleteLocationsNoResults',
          'autocompleteLocations',
          {
            query,
          },
        );
        return [];
      }

      // #952 【設計】Google は同じ場所を粒度違いで複数返すことがある
      // (例: 渋谷駅 →「日本、東京都渋谷区」の transit_station と
      //  「日本、東京都渋谷区２丁目２４」の番地レベル geocode の2件)。
      // ユーザーにとって同名候補の粒度差は意味を持たず単なる重複に見えるため、
      // ここで同名候補を1件に畳む。全クライアントに効かせるためサーバー側で行う。
      return this.dedupeAutocompletePlaces(places);
    } catch (error) {
      throw error;
    }
  }

  /**
   * #1176 【設計】Autocomplete 候補の重複除去は「表示が完全に同一のもの」だけに限定する。
   *
   * かつては #952(同名の非 establishment を落とす)と #1123(同名の鉄道駅を1件に畳む)の
   * ルールを持っていたが、いずれも **mainText(表示名)が同じなら同一地点とみなす**
   * 前提に立っていた。この前提は成立しない。
   *
   * `autocompleteLocations` のリクエストには locationBias / locationRestriction が無く、
   * 全国の候補が同一レスポンスに並び得る。日本には同名の別駅・別施設が多数実在する
   * (大久保駅 = 東京都新宿区 / 兵庫県明石市 / 京都府宇治市 / 秋田市 など)。
   * 名前ベースで畳むと、ユーザーが選びたい地点が候補から消えて **選択不能** になる(#1176)。
   *
   * 重複表示は「わずらわしい」だけだが、選択不能は「目的を達成できない」であり、
   * 損害の非対称性が大きい。したがって Google の返す候補は原則そのまま通す。
   *
   * 残す唯一の例外がルール2(完全重複)である。mainText と secondaryText の**両方**が
   * 一致する候補は、UI 上まったく区別が付かず、ユーザーはどちらを選んでも同じ体験になる。
   * この場合だけは畳んでも選択肢を奪わない。
   *
   * ルール:
   * 1. mainText / secondaryText を正規化(NFKC + 空白除去)する。
   * 2. mainText と secondaryText が**両方**一致する候補だけを1件に畳む。
   * 3. 返却順は Google の関連度順(元の配列順)を維持する。並び替えは行わない。
   *
   * 将来 locationBias を入れて候補が地理的に絞られるようになれば、名前ベースの
   * 畳み込みを再検討する余地はある。それまでは通す側に倒す。
   */
  private dedupeAutocompletePlaces(
    places: AutocompleteLocationsResponse,
  ): AutocompleteLocationsResponse {
    const normalizeKey = (text: string): string =>
      text.normalize('NFKC').replace(/\s+/g, '');

    const seenExactKeys = new Set<string>();

    return places.filter((place) => {
      // ルール2: mainText + secondaryText まで完全一致する候補は同一表示になるため1件に畳む
      const exactKey = `${normalizeKey(place.mainText)}\u0000${normalizeKey(
        place.secondaryText,
      )}`;
      if (seenExactKeys.has(exactKey)) {
        return false;
      }
      seenExactKeys.add(exactKey);

      return true;
    });
  }

  /**
   * Google Places API Details (New) を使用して地点の詳細情報を取得
   */
  async getLocationDetails(
    query: QueryLocationDetailsDto,
  ): Promise<LocationDetailsResponse> {
    try {
      const fieldMask = 'location,viewport,addressComponents';

      const response = await this.externalApiService.callPlaceDetails(
        fieldMask,
        query.placeId,
        query.languageCode,
        query.sessionToken,
      );

      if (
        !response.location ||
        !response.location.latitude ||
        !response.location.longitude ||
        !response.viewport ||
        !response.viewport.low ||
        !response.viewport.low.latitude ||
        !response.viewport.low.longitude ||
        !response.viewport.high ||
        !response.viewport.high.latitude ||
        !response.viewport.high.longitude ||
        !response.addressComponents
      ) {
        throw new Error(
          'Invalid response from Google Places API: Missing required fields',
        );
      }

      // #677 【設計】types 欠損のコンポーネントを許容し、使用可能なコンポーネントのみに正規化
      // Filter components that have at least one usable value (shortText or longText)
      // Missing types field is allowed (downstream methods handle it gracefully)
      const normalizedAddressComponents = response.addressComponents.filter(
        (component) => !!(component.shortText || component.longText),
      );

      if (normalizedAddressComponents.length === 0) {
        throw new Error(
          'Invalid response from Google Places API: No usable address components',
        );
      }

      // location field from response
      const location = {
        latitude: response.location.latitude,
        longitude: response.location.longitude,
      };

      // viewport field from response
      const viewport = {
        low: {
          latitude: response.viewport.low.latitude,
          longitude: response.viewport.low.longitude,
        },
        high: {
          latitude: response.viewport.high.latitude,
          longitude: response.viewport.high.longitude,
        },
      };

      // #677 Use normalized addressComponents for downstream processing
      const addressComponents = normalizedAddressComponents;
      const address = this.buildAddressFromComponents(addressComponents);

      // Resolve local language code from addressComponents
      const localLanguageCode =
        this.resolveLocalLanguageCode(addressComponents);

      this.logger.debug('LocationDetailsSuccess', 'getLocationDetails', {
        placeId: query.placeId,
        location,
        viewport,
        address,
        addressComponents,
        localLanguageCode,
      });

      return {
        location,
        viewport,
        address,
        localLanguageCode,
      };
    } catch (error) {
      this.logger.error('GooglePlacesDetailsCallError', 'getLocationDetails', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      throw error;
    }
  }

  /**
   * Google Geocoding API を使用した逆ジオコーディング
   */
  async getReverseGeocoding(
    query: QueryReverseGeocodingDto,
  ): Promise<LocationReverseGeocodingResponse> {
    try {
      const response = await this.externalApiService.callReverseGeocoding(
        query.lat,
        query.lng,
        'en', // Fixed to 'en' as per requirements
      );

      if (!response.results || response.results.length === 0) {
        throw new Error('No geocoding results found');
      }

      const result = response.results[0];

      if (
        !result.geometry?.location?.lat ||
        !result.geometry?.location?.lng ||
        !result.geometry?.viewport?.southwest?.lat ||
        !result.geometry?.viewport?.southwest?.lng ||
        !result.geometry?.viewport?.northeast?.lat ||
        !result.geometry?.viewport?.northeast?.lng ||
        !result.address_components
      )
        throw new Error(
          'Invalid geocoding result: Missing location coordinates',
        );

      const location = {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      };

      // viewport field from response
      const viewport = {
        low: {
          latitude: result.geometry.viewport.southwest.lat,
          longitude: result.geometry.viewport.southwest.lng,
        },
        high: {
          latitude: result.geometry.viewport.northeast.lat,
          longitude: result.geometry.viewport.northeast.lng,
        },
      };

      // Extract address from addressComponents
      const addressComponents = result.address_components.map((component) => ({
        shortText: component.short_name,
        longText: component.long_name,
        types: component.types || [],
      }));
      const address = this.buildAddressFromComponents(addressComponents);

      // Resolve local language code from addressComponents
      const localLanguageCode =
        this.resolveLocalLanguageCode(addressComponents);

      return {
        location,
        viewport,
        address,
        localLanguageCode,
      };
    } catch (error) {
      this.logger.error('GoogleGeocodingReverseError', 'getReverseGeocoding', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      throw error;
    }
  }

  /**
   * addressComponents から「国 → 都道府県/州 →（可能なら）市」までの住所を type-based に構築する
   *
   * ポイント:
   * - AddressComponent は複数 types を持つため、各 component について「代表 type」を決めて格納する
   * - 代表 type は、候補 types のうち「優先度が最も高い（＝数字が小さい）」ものを採用する
   * - 欠損に強くするため、locality が取れない場合は administrative_area_level_3..7 をフォールバックとして使う
   * - political / route / street_address など「階層」を表さない type は無視する
   *
   * 出力例: "country:JP, administrative_area_level_1:Kyoto, locality:Kyoto"
   */
  private buildAddressFromComponents(
    addressComponents: google.maps.places.v1.Place.IAddressComponent[],
  ): string {
    // 1) 「市まで」の主要ターゲット（優先度が高い順）
    const primaryTypes = [
      'country',
      'administrative_area_level_1',
      'administrative_area_level_2',
      'locality',
    ] as const;

    // 2) locality が取れない場合に限り、市相当として拾うフォールバック候補
    //    ※国・地域により locality が出ない/弱いケースの保険
    const localityFallbackTypes = [
      'administrative_area_level_3',
      'administrative_area_level_4',
      'administrative_area_level_5',
      'administrative_area_level_6',
      'administrative_area_level_7',
    ] as const;

    // 3) 優先度マップ（小さいほど上位）
    //    - primaryTypes は明示的に上位
    //    - fallback は locality より下位（locality が無いときだけ使う）
    const priorityMap = new Map<string, number>();
    primaryTypes.forEach((t, i) => priorityMap.set(t, i)); // 0..3
    localityFallbackTypes.forEach((t, i) => priorityMap.set(t, 100 + i)); // 100..（十分下位に）

    // 4) 代表 type ごとに最適な component を 1 つだけ保持する
    //    （同じ代表 type が複数あっても、より良い値の方を残す）
    const pickedByType = new Map<
      string,
      google.maps.places.v1.Place.IAddressComponent
    >();

    for (const comp of addressComponents) {
      const types = comp.types ?? [];
      if (types.length === 0) continue;

      // 4-1) この component の types の中から「優先度が最も高い type」を代表にする
      //      ※ priorityMap に無い type は無視（political 等を自然に排除）
      let bestType: string | null = null;
      let bestPriority = Number.POSITIVE_INFINITY;

      for (const t of types) {
        const p = priorityMap.get(t);
        if (p === undefined) continue;
        if (p < bestPriority) {
          bestPriority = p;
          bestType = t;
        }
      }

      if (!bestType) continue;

      // 4-2) 値（shortText優先 → longText）を持つ component のみ採用
      const value = (comp.shortText || comp.longText || '').trim();
      if (!value) continue;

      // 4-3) 同じ代表 type が既にあるなら、より良い方を残す
      //      ここでは「shortText を持つ方を優先」「同条件なら短い方を優先」を例にする
      const existing = pickedByType.get(bestType);
      if (!existing) {
        pickedByType.set(bestType, comp);
        continue;
      }

      const existingValue = (
        existing.shortText ||
        existing.longText ||
        ''
      ).trim();
      const existingHasShort = !!existing.shortText?.trim();
      const currentHasShort = !!comp.shortText?.trim();

      const shouldReplace =
        // shortText がある方を優先
        (currentHasShort && !existingHasShort) ||
        // どちらも shortText 条件が同じなら、より短い文字列を採用（例: "Kyoto" vs "Kyoto City"）
        (currentHasShort === existingHasShort &&
          value.length < existingValue.length);

      if (shouldReplace) {
        pickedByType.set(bestType, comp);
      }
    }

    // 5) locality が無い場合だけ、フォールバックから「市相当」を補う
    if (!pickedByType.has('locality')) {
      for (const t of localityFallbackTypes) {
        const c = pickedByType.get(t);
        if (!c) continue;

        // フォールバック type の component を locality として扱う（出力キーは locality に統一）
        pickedByType.set('locality', c);
        break;
      }
    }

    // 6) 出力（country → level_1 → level_2 → locality の順で整形）
    const result: string[] = [];
    for (const t of primaryTypes) {
      const c = pickedByType.get(t);
      if (!c) continue;

      const value = (c.shortText || c.longText || '').trim();
      if (!value) continue;

      result.push(`${t}:${value}`);
    }

    return result.join(', ');
  }
}
