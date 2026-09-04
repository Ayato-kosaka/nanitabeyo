// api/src/v1/restaurants/restaurants.service.ts
//
// ❶ Service for restaurants domain - business logic
// ❷ Following the pattern from dish-media/dish-media.service.ts
// ❸ Handles Google Place API integration, restaurant creation/search, dish media queries

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { Prisma } from '../../../../shared/prisma/client';
import {
  QueryRestaurantsDto,
  CreateRestaurantDto,
  CreateRestaurantDraftDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantsByGooglePlaceIdDto,
} from '@shared/v1/dto';
import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  CreateRestaurantDraftResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantsByGooglePlaceIdResponse,
  GetRestaurantByIdResponse,
  ErrorCode,
} from '@shared/v1/res';
import { RestaurantsRepository } from './restaurants.repository';
import { DishesRepository } from '../dishes/dishes.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { LocationsService } from '../locations/locations.service';
import { RestaurantsAssembler } from './restaurants.assembler';
import { isFoodAndDrinkPlaceForUser } from '../../../../shared/utils/google_places_restaurant_type';
import { google } from '@googlemaps/places/build/protos/protos';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
// #1780 店の代替画像（dish_media サムネイル）の入力型
import type { ThumbnailUrlSource } from '../dish-media/dish-media-thumbnail';
import {
  diffConfirmedRestaurantValues,
  signRestaurantDraftToken,
  verifyRestaurantDraftToken,
  type ConfirmedRestaurantValues,
  type RestaurantDraftTokenPayload,
} from './restaurant-draft.token';
import { env } from '../../core/config/env';
import {
  buildDisplayAddress,
  extractCountryName,
} from './restaurant-display-address';

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly assembler: RestaurantsAssembler,
    private readonly externalApi: ExternalApiService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaRepository: DishMediaRepository,
    private readonly locationsService: LocationsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  共通ヘルパー                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Google Place ID から既存レストランを検索する
   * - トランザクションの扱いは既存実装に合わせて PrismaService 側に委譲
   */
  private async findRestaurantByGooglePlaceId(
    googlePlaceId: string,
  ): Promise<PrismaRestaurants | null> {
    return this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.findRestaurantByGooglePlaceId(tx, googlePlaceId),
    );
  }

  /**
   * #1780 【設計】**`image_path` を持たない店の «顔» を dish_media サムネイルで埋める。**
   *
   * #1793 で Google の写真の複製をやめたので、これ以降に作られる店の `image_path` は
   * 必ず null になる。何もしないと **新しい店は全部«画像なし»** で、店詳細・店名検索・
   * 保存済み店・地図ピンが空の枠を描く（#1780 完了条件 4）。
   *
   * ⚠️ **1 クエリでまとめて引く。** ここを店ごとに引くと、店名検索や近隣一覧が
   *    店の数だけクエリを撃つ（N+1）。`image_path` を持つ店は代替が要らないので
   *    最初から問い合わせない。
   */
  private async fetchFallbackThumbnails(
    restaurants: PrismaRestaurants[],
  ): Promise<Map<string, ThumbnailUrlSource>> {
    const ids = restaurants.filter((r) => !r.image_path).map((r) => r.id);
    if (ids.length === 0) return new Map();

    return this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.dishMediaRepository.findFallbackThumbnailsByRestaurantIds(tx, ids),
    );
  }

  /**
   * レストランのレビュー / 入札メタ情報を取得
   * - 既存実装同様、トランザクションは個別に実行（挙動を変えない）
   */
  private async fetchRestaurantMeta(
    restaurantId: string,
  ): Promise<CreateRestaurantResponse['meta']> {
    const reviewStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantReviewStats(tx, restaurantId),
    );
    const bidStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantBidStats(tx, restaurantId),
    );

    return {
      reviewCount: reviewStats.reviewCount,
      averageRating: reviewStats.averageRating,
      totalCents: bidStats.totalCents,
      maxEndDate: bidStats.maxEndDate
        ? bidStats.maxEndDate.toISOString()
        : null,
    };
  }

  /**
   * Google Place のローカル言語コードを解決する
   * - 仕様により、ここでの異常は素の Error を投げる挙動を維持（エラーハンドリング方針は今は変えない）
   */
  private async resolveRestaurantLanguage(googlePlaceId: string): Promise<{
    languageCode: string;
    placeDetailForLocalLang: google.maps.places.v1.IPlace;
  }> {
    try {
      const fieldMask = 'addressComponents,types';
      const placeDetailForLocalLang = await this.externalApi.callPlaceDetails(
        fieldMask,
        googlePlaceId,
        'en',
      );

      if (!placeDetailForLocalLang.addressComponents) {
        throw new Error(
          'No address components for restaurant language code detection',
        );
      }

      const languageCode = this.locationsService.resolveLocalLanguageCode(
        placeDetailForLocalLang.addressComponents,
      );

      return { languageCode, placeDetailForLocalLang };
    } catch (error) {
      // 既存挙動を維持：ここでは HttpException ではなく Error
      throw new Error(
        'Failed to determine restaurant language code: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Place の types から飲食店かどうかを判定し、NG の場合は 422 を投げる
   */
  private ensureIsFoodAndDrink(
    placeDetailForLocalLang: google.maps.places.v1.IPlace,
    googlePlaceId: string,
  ): void {
    if (
      !isFoodAndDrinkPlaceForUser({
        types: placeDetailForLocalLang.types ?? [],
      })
    ) {
      throw new UnprocessableEntityException({
        code: ErrorCode.PLACE_NOT_FOOD_AND_DRINK,
        message:
          'The specified Google Place is not a restaurant or food & drink venue.',
        data: {
          googlePlaceId,
          types: placeDetailForLocalLang.types ?? [],
        },
      });
    }
  }

  /**
   * レストラン作成用に Place 詳細を取得し、必須フィールドをバリデーションする
   * - 不足フィールドがあれば Error を投げる（既存挙動を維持）
   * #1780 Google 写真の自社 Storage 保存をやめたため、photos は fieldMask から外し必須にもしない
   */
  private async fetchAndValidatePlaceDetail(
    googlePlaceId: string,
    languageCode: string,
  ): Promise<google.maps.places.v1.IPlace> {
    const fieldMask = [
      'id',
      'displayName',
      'location',
      'addressComponents',
      'plusCode',
    ].join(',');

    const placeDetail = await this.externalApi.callPlaceDetails(
      fieldMask,
      googlePlaceId,
      languageCode,
    );

    // 必須フィールドの存在チェック（型だけでなく値も確認）
    const missingFields: string[] = [];

    if (!placeDetail.id) missingFields.push('id');
    if (!placeDetail.displayName?.text) missingFields.push('displayName.text');
    if (typeof placeDetail.location?.latitude !== 'number')
      missingFields.push('location.latitude');
    if (typeof placeDetail.location?.longitude !== 'number')
      missingFields.push('location.longitude');
    if (!placeDetail.addressComponents) missingFields.push('addressComponents');

    if (missingFields.length > 0) {
      // ここは既存実装同様、詳細な place をログに出している（PII 対応は別課題として後回し）
      this.logger.error('InvalidPlaceData', 'createRestaurant', {
        placeId: placeDetail.id || 'unknown',
        missingFields,
        place: JSON.stringify(placeDetail),
      });
      throw new Error(
        `Invalid place data - missing fields: ${missingFields.join(', ')}`,
      );
    }

    return placeDetail;
  }

  /**
   * restaurants テーブルにレコードを登録
   * - Prisma.restaurantsCreateInput を利用し、id など DB が付与する値は指定しない
   * #1780 Google 写真の自社 Storage 保存をやめたため、image_path は常に null で作成する
   */
  private async createRestaurantRecord(params: {
    googlePlaceId: string;
    languageCode: string;
    placeDetail: google.maps.places.v1.IPlace;
    /**
     * #1671 確認ページでユーザーが確定させた値。
     * **これが渡されたときは Google の値ではなくこちらを保存する**（それがこの機能の目的）。
     */
    confirmed?: ConfirmedRestaurantValues;
  }): Promise<PrismaRestaurants> {
    const { googlePlaceId, languageCode, placeDetail, confirmed } = params;

    const restaurantData: Prisma.restaurantsCreateInput = {
      google_place_id: googlePlaceId,
      // バリデーション済みのため非 null アサーション
      name: confirmed?.name ?? placeDetail.displayName!.text!,
      name_language_code: languageCode,
      latitude: confirmed?.latitude ?? placeDetail.location!.latitude!,
      longitude: confirmed?.longitude ?? placeDetail.location!.longitude!,
      // #1671 62 万行のパイプライン製の行はここが空のままで、POI を押しても永久に埋まらなかった。
      // 確認ページを通ったときだけ、ユーザーが確認した値で埋める。
      // ⚠️ 確認を通っていない経路（draftToken なし）では **触らない**。
      //    Google の値を «確認済み» の顔で入れないため（それがこのチケットの主旨）。
      ...(confirmed
        ? { address: confirmed.address, country_code: confirmed.countryCode }
        : {}),
      // 【非推奨カラム】だがスキーマ上必須であれば空文字で維持
      image_url: '',
      image_path: null,
      // as を利用して Prisma.JsonValue にキャスト（JSON として保持する前提）
      address_components:
        placeDetail.addressComponents as unknown as Prisma.InputJsonValue,
      plus_code: placeDetail.plusCode
        ? (placeDetail.plusCode as unknown as Prisma.InputJsonValue)
        : undefined,
      // created_at は DB デフォルトがあれば省略可能だが、既存互換のため残す
      created_at: new Date(),
    };

    return this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.dishesRepository.createOrGetRestaurant(
        tx,
        restaurantData,
        googlePlaceId,
      ),
    );
  }

  /* ------------------------------------------------------------------ */
  /* POST /v1/restaurants/draft (#1671 確認ページの下読み)                */
  /* ------------------------------------------------------------------ */

  /**
   * #1671 既にある店の «確認ページの初期値» を、**自社 DB だけ**から組み立てる。
   * Google は 1 回も叩かない（→ `createRestaurantDraft` の冒頭コメント）。
   */
  private buildDraftFromExistingRestaurant(
    existing: PrismaRestaurants,
  ): CreateRestaurantDraftResponse {
    const addressComponents = Array.isArray(existing.address_components)
      ? (existing.address_components as unknown as Parameters<
          typeof buildDisplayAddress
        >[0])
      : [];

    // 列が空なら addressComponents から組み立てて初期値にする。
    // どちらも空なら空欄で出し、ユーザーが 1 から書く
    const countryCode =
      existing.country_code ||
      this.locationsService.extractCountryCode(
        addressComponents as Parameters<
          LocationsService['extractCountryCode']
        >[0],
      );
    const address =
      existing.address || buildDisplayAddress(addressComponents, countryCode);

    const payload: RestaurantDraftTokenPayload = {
      googlePlaceId: existing.google_place_id,
      name: existing.name,
      nameLanguageCode: existing.name_language_code,
      latitude: existing.latitude,
      longitude: existing.longitude,
      addressComponentsJson: JSON.stringify(addressComponents),
      plusCodeJson: existing.plus_code
        ? JSON.stringify(existing.plus_code)
        : null,
      address,
      countryCode,
    };

    this.logger.debug('RestaurantDraftFromExisting', 'createRestaurantDraft', {
      restaurantId: existing.id,
      googlePlaceId: existing.google_place_id,
    });

    return {
      draft: {
        googlePlaceId: payload.googlePlaceId,
        name: payload.name,
        nameLanguageCode: payload.nameLanguageCode,
        latitude: payload.latitude,
        longitude: payload.longitude,
        addressComponents,
        address,
        countryCode,
        countryName: extractCountryName(addressComponents),
      },
      draftToken: signRestaurantDraftToken(
        payload,
        env.SUPABASE_JWT_SECRET,
        Date.now(),
      ),
    };
  }

  /**
   * #1671 【設計】**店を作らずに、確認ページへ出す値だけを返す。**
   *
   * `createRestaurant` の «Google から取るところ» と同じ手順を踏むが、DB へは一切書かない。
   * 返す `draftToken` に Google 由来の既定値を署名して封じてあるので、
   * 続く `POST /v1/restaurants` は **Google を 1 回も叩かずに**
   * 「ユーザーが既定値を書き換えたか」を判定できる（→ `restaurant-draft.token.ts`）。
   *
   * ⚠️ **Google の呼び出し回数は増えない。** 従来 `createRestaurant` が行っていた
   * 2 回（言語判定・詳細取得）が、そのままここへ前倒しされるだけである。
   * ユーザーがキャンセルした場合は、従来なら «作られてしまっていた行» が減る。
   */
  async createRestaurantDraft(
    dto: CreateRestaurantDraftDto,
  ): Promise<CreateRestaurantDraftResponse> {
    /*
     * ⚠️ **既にある店なら Google を 1 回も叩かない。**
     *
     * #1671 で «住所が空の既存店も確認ページへ回す» ようにしたが、素朴に実装すると
     * この下読みが走り、**それまで 0 回だった経路へ Place Details が 2 回**（#1781 の
     * ⑥ Essentials + ⑦ Pro）増える。パイプライン製の 62 万行はほぼ全部が住所空なので、
     * 「POI を押すたびに 2 回」に等しい。#1781 の実測では ④⑥⑦ 合計で月 3,887 回、
     * Pro の無料枠は月 5,000 回しかないため、**#843 の趣旨に反して課金が始まりうる**。
     *
     * 既にある店の名前・座標は**自社 DB に入っている**。足りないのは住所で、それは
     * ユーザーが確認画面で入れる。**Google に聞く理由が無い。**
     */
    const existing = await this.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
    );
    if (existing) {
      return this.buildDraftFromExistingRestaurant(existing);
    }

    const { languageCode, placeDetailForLocalLang } =
      await this.resolveRestaurantLanguage(dto.googlePlaceId);

    this.ensureIsFoodAndDrink(placeDetailForLocalLang, dto.googlePlaceId);

    let placeDetail: google.maps.places.v1.IPlace;
    try {
      placeDetail = await this.fetchAndValidatePlaceDetail(
        dto.googlePlaceId,
        languageCode,
      );
    } catch (error) {
      // createRestaurant と同じマッピング（Place 詳細が取れない = 404）
      this.logger.error('GooglePlaceDetailsFailed', 'createRestaurantDraft', {
        googlePlaceId: dto.googlePlaceId,
        error: (error as Error).message,
      });
      throw new NotFoundException('Google Place not found or invalid');
    }

    const addressComponents = placeDetail.addressComponents ?? [];
    const countryCode = this.locationsService.extractCountryCode(
      addressComponents as Parameters<
        LocationsService['extractCountryCode']
      >[0],
    );

    const payload: RestaurantDraftTokenPayload = {
      googlePlaceId: dto.googlePlaceId,
      name: placeDetail.displayName!.text!,
      nameLanguageCode: languageCode,
      latitude: placeDetail.location!.latitude!,
      longitude: placeDetail.location!.longitude!,
      addressComponentsJson: JSON.stringify(addressComponents),
      plusCodeJson: placeDetail.plusCode
        ? JSON.stringify(placeDetail.plusCode)
        : null,
      address: buildDisplayAddress(addressComponents, countryCode),
      countryCode,
    };

    this.logger.debug('RestaurantDraftIssued', 'createRestaurantDraft', {
      googlePlaceId: dto.googlePlaceId,
      countryCode,
    });

    return {
      draft: {
        googlePlaceId: payload.googlePlaceId,
        name: payload.name,
        nameLanguageCode: payload.nameLanguageCode,
        latitude: payload.latitude,
        longitude: payload.longitude,
        addressComponents,
        address: payload.address,
        countryCode,
        // 表示専用。保存するのは countryCode のままなので、トークンには封じない
        countryName: extractCountryName(addressComponents),
      },
      draftToken: signRestaurantDraftToken(
        payload,
        env.SUPABASE_JWT_SECRET,
        Date.now(),
      ),
    };
  }

  /**
   * #1671 `draftToken` を検証し、**保存に使う値**と**書き換えられた項目**を返す。
   *
   * トークンが無ければ `null`（＝従来どおり Google の値をそのまま保存する経路）。
   * トークンが壊れている・期限切れ・別の店のものなら 400 で弾く。
   */
  private resolveConfirmedValues(dto: CreateRestaurantDto): {
    baseline: RestaurantDraftTokenPayload;
    confirmed: ConfirmedRestaurantValues;
    changedFields: string[];
  } | null {
    if (!dto.draftToken) return null;

    const baseline = verifyRestaurantDraftToken(
      dto.draftToken,
      env.SUPABASE_JWT_SECRET,
      Date.now(),
    );
    if (!baseline) {
      throw new BadRequestException(
        'draftToken is invalid or expired. Re-open the confirmation page.',
      );
    }

    // ⚠️ 別の店のトークンを付け替えて «確認済み» を騙れないようにする。
    //    ここが無いと、A 店の下読みで得たトークンで B 店を好きな値で作れる。
    if (baseline.googlePlaceId !== dto.googlePlaceId) {
      throw new BadRequestException(
        'draftToken was issued for a different googlePlaceId.',
      );
    }

    const confirmed: ConfirmedRestaurantValues = {
      name: dto.name ?? baseline.name,
      latitude: dto.latitude ?? baseline.latitude,
      longitude: dto.longitude ?? baseline.longitude,
      address: dto.address ?? baseline.address,
      countryCode: dto.countryCode ?? baseline.countryCode,
    };

    return {
      baseline,
      confirmed,
      changedFields: diffConfirmedRestaurantValues(baseline, confirmed),
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/search (nearby restaurant search)               */
  /* ------------------------------------------------------------------ */
  async searchRestaurants(
    dto: QueryRestaurantsDto,
  ): Promise<QueryRestaurantsResponse> {
    this.logger.debug('SearchRestaurants', 'searchRestaurants', {
      lat: dto.lat,
      lng: dto.lng,
      radius: dto.radius,
    });

    // 近隣レストラン + 入札状況を DB から取得
    const results = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.searchNearbyRestaurants(tx, dto),
    );

    this.logger.debug('SearchRestaurantsResult', 'searchRestaurants', {
      count: results.length,
    });

    // #1780 画像を持たない店の代替サムネイルを 1 クエリでまとめて引いてから詰める
    const fallbacks = await this.fetchFallbackThumbnails(
      results.map((r) => r.restaurant),
    );

    // レスポンス変換は assembler に統一
    return results.map((r) => ({
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(
        r.restaurant,
        fallbacks.get(r.restaurant.id),
      ),
      meta: r.meta,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* POST /v1/restaurants (Google Place ID creation)                     */
  /* ------------------------------------------------------------------ */
  async createRestaurant(
    dto: CreateRestaurantDto,
  ): Promise<CreateRestaurantResponse> {
    this.logger.debug('CreateRestaurant', 'createRestaurant', {
      dto,
    });

    // 1. 対象の Google Place ID の restaurant が存在するか確認
    const existingRestaurant = await this.findRestaurantByGooglePlaceId(
      dto.googlePlaceId,
    );

    if (existingRestaurant) {
      /*
       * #1671 【設計】**既存店でも «空いている住所・国コード» は埋める。**
       *
       * パイプライン製の 62 万行は `address` / `country_code` が空のままで、
       * ユーザーが POI を押しても «既存店だからそのまま開く» のでこの穴は
       * **永久に埋まらなかった**（チケット本文の指摘そのもの）。
       *
       * 確認ページを通ってきた（= draftToken がある）ときだけ埋める。
       * ⚠️ 既に入っている値は上書きしない（→ `fillMissingAddress` のコメント）。
       */
      let restaurant = existingRestaurant;
      const confirmationForExisting = this.resolveConfirmedValues(dto);

      if (confirmationForExisting) {
        const filled = await this.prisma.withTransaction(
          (tx: Prisma.TransactionClient) =>
            this.repo.fillMissingAddress(tx, {
              restaurantId: existingRestaurant.id,
              address: confirmationForExisting.confirmed.address,
              countryCode: confirmationForExisting.confirmed.countryCode,
            }),
        );

        if (filled > 0) {
          this.logger.log('RestaurantAddressFilled', 'createRestaurant', {
            restaurantId: existingRestaurant.id,
            changedFields: confirmationForExisting.changedFields,
          });
          // 埋めた値を返す（呼び出し元が古い値をキャッシュしないため）
          restaurant =
            (await this.findRestaurantByGooglePlaceId(dto.googlePlaceId)) ??
            existingRestaurant;
        }
      }

      const meta = await this.fetchRestaurantMeta(restaurant.id);
      const fallbacks = await this.fetchFallbackThumbnails([restaurant]);

      return {
        restaurant: this.assembler.enrichRestaurantsWithImageUrls(
          restaurant,
          fallbacks.get(restaurant.id),
        ),
        meta,
      };
    }

    // 2. 新規作成フロー
    //
    // #1671 確認ページを通ってきた場合（draftToken あり）は、Google 由来の値も
    // 現地言語コードも**署名済みトークンの中に入っている**ので、
    // **Google を 1 回も叩かずに**そのまま登録できる。
    const confirmation = this.resolveConfirmedValues(dto);

    if (confirmation) {
      const { baseline, confirmed, changedFields } = confirmation;

      const restaurant = await this.createRestaurantRecord({
        googlePlaceId: dto.googlePlaceId,
        languageCode: baseline.nameLanguageCode,
        // トークンへ封じた Google 由来の値を、Place 詳細の代わりに使う
        placeDetail: {
          displayName: { text: baseline.name },
          location: {
            latitude: baseline.latitude,
            longitude: baseline.longitude,
          },
          addressComponents: JSON.parse(
            baseline.addressComponentsJson,
          ) as google.maps.places.v1.IPlace['addressComponents'],
          plusCode: baseline.plusCodeJson
            ? (JSON.parse(
                baseline.plusCodeJson,
              ) as google.maps.places.v1.IPlace['plusCode'])
            : undefined,
        },
        confirmed,
      });

      // ⚠️ **書き換えを «記録する» ところまでがこのチケットの要件**である。
      //    どう扱うか（追認する / 荒らしとして扱う）は #1827 で決めるので、
      //    ここでは判断せず、後から数えられる形で残すだけにする。
      this.logger.log('RestaurantCreatedFromConfirmation', 'createRestaurant', {
        restaurantId: restaurant.id,
        googlePlaceId: restaurant.google_place_id,
        changedFields,
        userEditedDefaults: changedFields.length > 0,
      });

      const meta = await this.fetchRestaurantMeta(restaurant.id);
      const fallbacks = await this.fetchFallbackThumbnails([restaurant]);
      return {
        restaurant: this.assembler.enrichRestaurantsWithImageUrls(
          restaurant,
          fallbacks.get(restaurant.id),
        ),
        meta,
      };
    }

    // 2-1. 対象の Google Place ID の restaurant の現地の言語コードを特定
    const { languageCode: restaurantLanguageCode, placeDetailForLocalLang } =
      await this.resolveRestaurantLanguage(dto.googlePlaceId);

    // 2-2. types による飲食店判定
    this.ensureIsFoodAndDrink(placeDetailForLocalLang, dto.googlePlaceId);

    // 2-3. Place 詳細を取得して DB 登録まで実行
    let restaurant: PrismaRestaurants;

    try {
      const placeDetail = await this.fetchAndValidatePlaceDetail(
        dto.googlePlaceId,
        restaurantLanguageCode,
      );

      restaurant = await this.createRestaurantRecord({
        googlePlaceId: dto.googlePlaceId,
        languageCode: restaurantLanguageCode,
        placeDetail,
      });

      this.logger.debug('RestaurantCreated', 'createRestaurant', {
        restaurantId: restaurant.id,
        name: restaurant.name,
        googlePlaceId: restaurant.google_place_id,
      });
    } catch (error) {
      // 既存実装と同様、Place 詳細取得〜登録処理でのエラーは 404 にマッピング
      this.logger.error('GooglePlaceDetailsFailed', 'createRestaurant', {
        googlePlaceId: dto.googlePlaceId,
        error: (error as Error).message,
      });
      throw new NotFoundException('Google Place not found or invalid');
    }

    // 新規作成直後はレビュー/入札は 0 のことが多いが、
    // 既存実装との相性を保ちつつ meta は常に fetch する
    const meta = await this.fetchRestaurantMeta(restaurant.id);

    /*
    #1780 作ったばかりの店には dish_media がまだ 1 件も無いので、ここは必ず空振りする。
    それでも呼ぶのは、**既存店が createRestaurant を通り抜けてくる**（同じ place_id で
    2 回目以降）ときに «画像がある店だけ画像が出ない» のを作らないため。
    */
    const fallbacks = await this.fetchFallbackThumbnails([restaurant]);

    return {
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(
        restaurant,
        fallbacks.get(restaurant.id),
      ),
      meta,
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/{id}/dish-media (restaurant dish media list)    */
  /* ------------------------------------------------------------------ */
  async getRestaurantDishMedia(
    restaurantId: string,
    dto: QueryRestaurantDishMediaDto,
    userId: string,
  ): Promise<QueryRestaurantDishMediaResponse> {
    this.logger.debug('GetRestaurantDishMedia', 'getRestaurantDishMedia', {
      restaurantId,
      cursor: dto.cursor,
      viewer: userId, // ログイン必須 API のため、冗長な 'anon' フォールバックは削除
    });

    // 対象レストランが存在するか検証
    const restaurantExists = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.restaurantExists(tx, restaurantId),
    );
    if (!restaurantExists) {
      throw new NotFoundException('Restaurant not found');
    }

    // レストランに紐づく dish media をページング取得
    const dishMediaByRestaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.dishMediaRepository.findDishMediaByRestaurant(
          tx,
          restaurantId,
          dto,
        ),
    );

    const dishMediaIds = dishMediaByRestaurant.items.map(
      (l) => l.dish_media_id,
    );

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    this.logger.debug(
      'GetRestaurantDishMediaResult',
      'getRestaurantDishMedia',
      {
        count: dishMediaEntryItemsResult.items.length,
      },
    );

    // 戻り値の型は Promise<QueryRestaurantDishMediaResponse> に統一
    return {
      data: dishMediaEntryItemsResult.items,
      nextCursor: dishMediaByRestaurant.nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/:id (restaurant by ID)                          */
  /* ------------------------------------------------------------------ */
  async getRestaurantById(
    restaurantId: string,
  ): Promise<GetRestaurantByIdResponse> {
    this.logger.debug('GetRestaurantById', 'getRestaurantById', {
      restaurantId,
    });

    // #644 【設計】restaurant.id でレストラン情報を取得
    const restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantById(tx, restaurantId),
    );

    if (!restaurant) {
      this.logger.debug('RestaurantNotFound', 'getRestaurantById', {
        restaurantId,
      });
      throw new NotFoundException('Restaurant not found');
    }

    // レビュー統計情報を取得
    const reviewStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantReviewStats(tx, restaurant.id),
    );

    // 入札統計情報を取得
    const bidStats = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.getRestaurantBidStats(tx, restaurant.id),
    );

    this.logger.debug('RestaurantFound', 'getRestaurantById', {
      restaurantId: restaurant.id,
      name: restaurant.name,
      reviewCount: reviewStats.reviewCount,
      averageRating: reviewStats.averageRating,
    });

    const fallbacks = await this.fetchFallbackThumbnails([restaurant]);

    return {
      restaurant: this.assembler.enrichRestaurantsWithImageUrls(
        restaurant,
        fallbacks.get(restaurant.id),
      ),
      meta: {
        reviewCount: reviewStats.reviewCount,
        averageRating: reviewStats.averageRating,
        totalCents: bidStats.totalCents,
        maxEndDate: bidStats.maxEndDate
          ? bidStats.maxEndDate.toISOString()
          : null,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/restaurants/by-google-place-id (Google Place ID query)      */
  /* ------------------------------------------------------------------ */
  async getRestaurantByGooglePlaceId(
    dto: QueryRestaurantsByGooglePlaceIdDto,
  ): Promise<QueryRestaurantsByGooglePlaceIdResponse | null> {
    this.logger.debug(
      'GetRestaurantByGooglePlaceId',
      'getRestaurantByGooglePlaceId',
      {
        googlePlaceId: dto.googlePlaceId,
      },
    );

    // DB からレストランを検索
    const restaurant = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findRestaurantByGooglePlaceId(tx, dto.googlePlaceId),
    );

    if (!restaurant) {
      this.logger.debug('RestaurantNotFound', 'getRestaurantByGooglePlaceId', {
        googlePlaceId: dto.googlePlaceId,
      });
      return null;
    }

    this.logger.debug('RestaurantFound', 'getRestaurantByGooglePlaceId', {
      restaurantId: restaurant.id,
      name: restaurant.name,
    });

    // ここも assembler に統一
    const fallbacks = await this.fetchFallbackThumbnails([restaurant]);
    return this.assembler.enrichRestaurantsWithImageUrls(
      restaurant,
      fallbacks.get(restaurant.id),
    );
  }
}
