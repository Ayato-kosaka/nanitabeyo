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
    const countryComponent = addressComponents.find((component) =>
      component.types?.includes('country'),
    );
    const adminLevel1Component = addressComponents.find((component) =>
      component.types?.includes('administrative_area_level_1'),
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
   * #1123 【設計】「この mainText には鉄道駅が実在する」と断定してよい、鉄道駅固有の
   * type の集合(= 畳み込みの"根拠"となる type)。
   *
   * 含めた理由:
   * - train_station / subway_station:
   *   鉄道駅にのみ付く type。鉄道駅は同一エリア内に同名の別駅が存在しないため、
   *   同名なら同一駅とみなして安全に畳める。
   *
   * 含めなかった理由(安全側 = 同名の別地点を消さない側に倒す):
   * - transit_station:
   *   交通施設全般に付く汎用 type で、実データではバス停も
   *   ["bus_station", "transit_station", "point_of_interest", "establishment"]
   *   のように併せ持つ(PR #1149 レビュー指摘)。これ単独では駅と断定できないため
   *   「根拠」には使わない。ただし後述のとおり「畳む対象」には含める
   *   (COLLAPSIBLE_TRANSIT_TYPES 参照)。
   * - light_rail_station:
   *   PR #1149 レビュー指摘。路面電車の停留場は運用上バス停に近い命名
   *   (上り/下りが同名で道路を挟んだ別地点)になる地域があるため根拠にしない。
   *   同名の停留場同士だけが並ぶケースでは鉄道駅固有 type が現れないので畳まれない。
   * - bus_station / bus_stop / transit_depot:
   *   「渋谷駅前」のように、同名でも進行方向・のりば・事業者ごとに別地点として
   *   存在するのが正常。畳むとユーザーが選びたいのりばを選べなくなる。
   * - airport / international_airport / ferry_terminal / heliport / taxi_stand /
   *   park_and_ride:
   *   同名でターミナル違い等の別地点が正当に併存しうるうえ、#1123 のような粒度違い
   *   重複の実例が確認できていないため対象外とする。
   */
  private static readonly RAIL_STATION_TYPES: ReadonlySet<string> = new Set([
    'train_station',
    'subway_station',
  ]);

  /**
   * #1123 【設計】「同名の鉄道駅が実在する」と分かっているときに、その駅の粒度違い
   * 重複として畳んでよい交通施設 type の集合。
   *
   * development 実環境の実測(Issue #1123 の検証コメント)では、渋谷駅の関連度順
   * 先頭候補(ChIJz8MVLFiLGGARXP0DqqhoDow)の types は
   * ["point_of_interest", "transportation_service", "establishment", "transit_station"]
   * で、鉄道駅固有 type を持たず交通系は汎用の transit_station だけだった
   * (新宿駅・東京駅も同じ構造)。つまり「駅施設側」の候補は transit_station しか
   * 持たないことがあるため、transit_station も畳み込み対象に含める必要がある。
   *
   * PR #1149 で懸念された「同名の別バス停が畳まれる」問題は、transit_station を
   * ここに入れるだけでは起きない。畳み込みには別途
   * 「同名に RAIL_STATION_TYPES を持つ候補が存在する」ことを要求するため、
   * バス停同士(鉄道駅固有 type がどこにも現れない)は根拠が無く畳まれない。
   * これは NEVER_COLLAPSE_TRANSIT_TYPES による type ベースの保護より堅い:
   * 実環境には bus_station を持たない(types が establishment / point_of_interest
   * だけの)バス停が存在し、deny-list だけでは守れないため。
   *
   * 【受容済みリスク】(PR #1175 の独立レビュー 指摘3)
   * 鉄道駅と同名で、かつ bus 系 type が欠落して transit_station だけを持つバス停は
   * 畳まれる。上記のとおり Google の type 付与は欠落し得るため、deny-list による
   * 保護は bus 系 type が付いている場合に限られる。
   * この型シルエットは #1123 で畳みたい「駅施設側」候補と type だけでは区別できず、
   * 畳まなければ #1123 が直らないため、畳む側を選んでいる。
   */
  private static readonly COLLAPSIBLE_TRANSIT_TYPES: ReadonlySet<string> =
    new Set([...LocationsService.RAIL_STATION_TYPES, 'transit_station']);

  /**
   * #1123 【設計】同名でも別地点として正当に併存する交通施設の type 集合。
   *
   * PR #1149 レビュー指摘を受けた多重防御。これらの type を1つでも持つ候補は、
   * たとえ鉄道駅 type を併せ持っていても(例: 駅前ロータリーのバスターミナルが
   * train_station を併記するケース)同名畳み込みの対象外とし、常に残す。
   * 畳み込みの"根拠"としても数えない(バスターミナル1件を根拠に同名の駅候補を
   * 畳んでしまわないため)。
   */
  private static readonly NEVER_COLLAPSE_TRANSIT_TYPES: ReadonlySet<string> =
    new Set(['bus_station', 'bus_stop', 'transit_depot']);

  /**
   * #952 【設計】Autocomplete 候補の「同一地点の粒度違い重複」を除去する。
   *
   * ルール(PR #980 レビュー指摘を受けた改訂版 / #1123 でルール3-bを追加):
   * 1. mainText を正規化(NFKC + 空白除去)したものを同名判定のキーにする。
   *    「渋谷駅」と「渋谷駅前」のような別名は別キーになり残る。
   * 2. 落とすのは「同名の establishment(実在施設)が存在する場合の非 establishment 候補」
   *    だけに限定する。これが「渋谷駅(駅)と 渋谷駅(番地レベル geocode)」のような
   *    同一地点の粒度違い重複に相当する。
   * 3. 同名でも establishment 同士(例: 同名チェーンの別店舗。place_id・secondaryText が
   *    異なる別の実在地点)は全て残す。表示名だけで別地点を消してはならない。
   * 3-b. #1123 例外: 「同名の鉄道駅の粒度違い重複」は establishment 同士であっても
   *    Google の関連度順で先頭の1件だけを残す。誤爆を防ぐため次の3条件を全て満たす
   *    候補だけを対象にする:
   *    (i)  同名(正規化後の mainText が一致)の候補の中に、鉄道駅固有 type
   *         (RAIL_STATION_TYPES)を持つものが1件以上ある = 鉄道駅が実在する根拠
   *    (ii) その候補自身が交通施設 type(COLLAPSIBLE_TRANSIT_TYPES)を持つ
   *         = 駅施設側の粒度違い候補。実データでは transit_station しか持たない
   *           ことがあるため汎用 type も含める(#1123 検証コメント)
   *    (iii) バス停など NEVER_COLLAPSE_TRANSIT_TYPES を持たない(PR #1149 指摘)
   *    (i) により、同名のバス停同士・停留場同士(鉄道駅固有 type がどこにも無い)は
   *    そもそも対象にならない。交通系 type を持たない同名候補(チェーン店舗や、
   *    types が establishment / point_of_interest だけのバス停)は (ii) で対象外。
   * 4. 完全重複(mainText と secondaryText の両方が一致)だけは同名同士でも1件に畳む。
   * 5. 返却順は Google の関連度順(元の配列順)を維持する。並び替えは行わない。
   */
  private dedupeAutocompletePlaces(
    places: AutocompleteLocationsResponse,
  ): AutocompleteLocationsResponse {
    const normalizeKey = (text: string): string =>
      text.normalize('NFKC').replace(/\s+/g, '');

    const isEstablishment = (place: { types: string[] }): boolean =>
      place.types.includes('establishment');

    const hasAnyType = (
      place: { types: string[] },
      typeSet: ReadonlySet<string>,
    ): boolean => place.types.some((type) => typeSet.has(type));

    // #1123 PR #1149: 同名でも別地点が正当に併存するバス停系 type を持つ候補は、
    // 鉄道駅 type を併せ持っていても畳み込み対象にしない(安全側に倒す)。
    const isNeverCollapse = (place: { types: string[] }): boolean =>
      hasAnyType(place, LocationsService.NEVER_COLLAPSE_TRANSIT_TYPES);

    // #1123 ルール3-b(i): 鉄道駅固有 type を持つ候補が存在する mainText キーの集合。
    // 「同名の鉄道駅が実在する」根拠。これが無い同名グループ(バス停同士など)は
    // 畳み込みを一切行わない。
    const railStationNameKeys = new Set(
      places
        .filter(
          (place) =>
            hasAnyType(place, LocationsService.RAIL_STATION_TYPES) &&
            !isNeverCollapse(place),
        )
        .map((place) => normalizeKey(place.mainText)),
    );

    // #1123 ルール3-b: 同名の鉄道駅の粒度違い重複として畳んでよい候補かどうか
    const isCollapsibleStation = (
      place: { types: string[] },
      nameKey: string,
    ): boolean =>
      railStationNameKeys.has(nameKey) &&
      hasAnyType(place, LocationsService.COLLAPSIBLE_TRANSIT_TYPES) &&
      !isNeverCollapse(place);

    // 同名の establishment が1件でも存在する mainText キーの集合
    const establishmentNameKeys = new Set(
      places
        .filter((place) => isEstablishment(place))
        .map((place) => normalizeKey(place.mainText)),
    );

    const seenExactKeys = new Set<string>();
    // #1123 既に採用済みの鉄道駅候補の mainText キー(関連度順で先頭の1件が入る)
    const keptRailStationNameKeys = new Set<string>();

    return places.filter((place) => {
      const nameKey = normalizeKey(place.mainText);

      // ルール4: mainText + secondaryText まで完全一致する候補は同一表示になるため1件に畳む
      const exactKey = `${nameKey}\u0000${normalizeKey(place.secondaryText)}`;
      if (seenExactKeys.has(exactKey)) {
        return false;
      }
      seenExactKeys.add(exactKey);

      // ルール2: 同名の establishment が存在するなら、非 establishment(番地レベルの
      // geocode / street_address / premise 等)は同一地点の粒度違いとみなして落とす
      if (!isEstablishment(place) && establishmentNameKeys.has(nameKey)) {
        return false;
      }

      // ルール3-b(#1123): 同名の鉄道駅候補は先頭(= Google の関連度順で最上位)のみ残す。
      // 走査順が元の配列順のため、採用済みキーを持つ後続の駅候補だけが落ちる。
      if (isCollapsibleStation(place, nameKey)) {
        if (keptRailStationNameKeys.has(nameKey)) {
          return false;
        }
        keptRailStationNameKeys.add(nameKey);
      }

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
