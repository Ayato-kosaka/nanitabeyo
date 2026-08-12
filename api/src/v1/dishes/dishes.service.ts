// api/src/v1/dishes/dishes.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・外部API を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ Google Maps API との連携処理
//

import { Injectable } from '@nestjs/common';

import { CreateDishDto, BulkImportDishesDto } from '@shared/v1/dto';
import {
  CreateDishResponse,
  BulkImportDishesResponse,
  DishMediaEntry,
} from '@shared/v1/res';

import { DishesRepository } from './dishes.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { LocationsService } from '../locations/locations.service';
import { RemoteConfigService } from '../../core/remote-config/remote-config.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { DishMediaService } from '../dish-media/dish-media.service';
import { StorageService } from '../../core/storage/storage.service';

// Import converters
import {
  convertPrismaToSupabase_Dishes,
  PrismaDishes,
  SupabaseDishes,
} from '../../../../shared/converters/convert_dishes';
import { SupabaseRestaurants } from '../../../../shared/converters/convert_restaurants';
import { SupabaseDishMedia } from '../../../../shared/converters/convert_dish_media';
import { SupabaseDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { CreateDishMediaEntryJobPayload } from '../../internal/dishes/create-dish-media-entry.interface';
import { buildFullPath, getExt } from 'src/core/storage/storage.utils';
import {
  buildGoogleImportDishMediaId,
  buildGoogleImportDishReviewId,
} from './deterministic-id';

// Google Maps types for photo handling
import { protos } from '@googlemaps/places';
import { selectGooglePlaceReviews } from './select-google-place-reviews';
import { normalizeLanguageCode } from '../../../../shared/utils/languageCode';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly logger: AppLoggerService,
    private readonly locationsService: LocationsService,
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cloudTasksService: CloudTasksService,
    private readonly dishCategoriesRepository: DishCategoriesRepository,
    private readonly restaurantsRepository: RestaurantsRepository,
    private readonly prisma: PrismaService,
    private readonly dishMediaService: DishMediaService,
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dishes (作成 or 取得)                 */
  /* ------------------------------------------------------------------ */
  async createOrGetDish(dto: CreateDishDto): Promise<CreateDishResponse> {
    this.logger.debug('CreateOrGetDish', 'createOrGetDish', dto);

    // 既存のdishを検索
    const existingDish = await this.repo.findDishByRestaurantAndCategory(
      dto.restaurantId,
      dto.dishCategoryId,
    );

    if (existingDish) {
      this.logger.debug('ExistingDishFound', 'createOrGetDish', {
        dishId: existingDish.id,
      });
      return convertPrismaToSupabase_Dishes(existingDish);
    }

    // DishCategory と Restaurant を取得し、ローカル言語を推測して dishName を決定
    const dishCategory =
      await this.dishCategoriesRepository.findDishCategoryById(
        dto.dishCategoryId,
      );
    if (!dishCategory) {
      this.logger.error('DishCategoryNotFound', 'createOrGetDish', {
        dishCategoryId: dto.dishCategoryId,
      });
      throw new Error('Dish category not found');
    }

    const restaurant = await this.prisma.prisma.$transaction(async (tx) => {
      return this.restaurantsRepository.findRestaurantById(
        tx,
        dto.restaurantId,
      );
    });
    if (!restaurant) {
      this.logger.error('RestaurantNotFound', 'createOrGetDish', {
        restaurantId: dto.restaurantId,
      });
      throw new Error('Restaurant not found');
    }

    // レストランの住所情報からローカル言語コードを推測
    const languageCode = this.locationsService.resolveLocalLanguageCode(
      restaurant.address_components as protos.google.maps.places.v1.Place.IAddressComponent[],
    );

    const dishNameFromLabels: string =
      (dishCategory.labels && dishCategory.labels[languageCode]) ||
      dishCategory.label_en;

    // 新規作成（推測名を注入。なければフォールバック）
    const newDish = await this.prisma.prisma.$transaction(async (tx) => {
      return this.repo.createOrGetDishForCategory(tx, {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategoryId,
        name: dishNameFromLabels,
      });
    });

    this.logger.log('DishCreated', 'createOrGetDish', newDish);

    return convertPrismaToSupabase_Dishes(newDish);
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dishes/bulk-import (Google一括登録)            */
  /* ------------------------------------------------------------------ */
  async bulkImportFromGoogle(
    dto: BulkImportDishesDto,
    viewerId: string,
  ): Promise<BulkImportDishesResponse> {
    this.logger.debug('BulkImportFromGoogle', 'bulkImportFromGoogle', dto);

    // Remote Config から検索件数設定を取得
    const restaurantSearchCount =
      await this.remoteConfigService.getRemoteConfigValue(
        'v1_search_result_restaurants_number',
      );
    const pageSize = parseInt(restaurantSearchCount, 10) || 5; // デフォルト値

    // Google Maps Text Search API を呼び出し
    const googlePlaces = await this.locationsService.searchRestaurants({
      location: dto.location,
      radius: dto.radius,
      dishCategoryName: dto.categoryName,
      minRating: dto.minRating,
      languageCode: dto.languageCode,
      priceLevels: dto.priceLevels, // Now optional, can be undefined
      pageSize,
    });

    // #636 【バグ】contextualContents は experimental で返却保証が弱いため、places のみ必須とする
    // 【設計】0件は異常ではなく「その地点・カテゴリに該当店舗が無かった」という正常な結果。
    // searchRestaurants は3段のフォールバック（full → relaxed → minimal）を尽くしたうえで
    // places を持たない空レスポンスを返す契約なので、ここを throw にすると
    // 該当なしの検索がすべて 500 INTERNAL_ERROR になる。空配列を返してクライアントへ委ねる。
    if (!googlePlaces?.places || googlePlaces.places.length === 0) {
      this.logger.warn('BulkImportNoPlacesFound', 'bulkImportFromGoogle', {
        location: dto.location,
        radius: dto.radius,
        categoryName: dto.categoryName,
        categoryId: dto.categoryId,
      });
      return [];
    }

    const contextualContents = googlePlaces?.contextualContents;

    // #636 【設計】contextualContents と places の長さが一致しない場合は警告ログを出す
    const canUseContextual =
      !!contextualContents &&
      contextualContents.length === googlePlaces.places.length;
    if (contextualContents && !canUseContextual) {
      this.logger.warn(
        'ContextualContentsLengthMismatch',
        'bulkImportFromGoogle',
        {
          placesLength: googlePlaces.places.length,
          contextualContentsLength: contextualContents.length,
        },
      );
    } else if (!contextualContents) {
      this.logger.debug('ContextualContentsMissing', 'bulkImportFromGoogle', {
        placesLength: googlePlaces.places.length,
      });
    }

    const results: BulkImportDishesResponse = [];
    const placeIds = googlePlaces.places
      .map((place) => place.id)
      .filter((placeId): placeId is string => Boolean(placeId));

    // #1053 【退避】preflight を Remote Config で無効化できるようにする。
    // DB 由来の不具合が出たときに、コードデプロイなしで従来の「常に新規作成」へ戻す。
    const preflightEnabled =
      (await this.remoteConfigService.getRemoteConfigValue(
        'v1_bulk_import_preflight_enabled',
      )) !== 'false';

    // #829 【性能】Photo Media 前に、Text Search 結果の place/category だけを batch lookup する。
    // completed は課金削減のため即再利用し、未完了 Google import は同じ ID で再処理してレスポンス ID の不整合を避ける。
    const reusableMediaByPlaceId = preflightEnabled
      ? await this.repo.findReusableGoogleImportDishMediaByPlaceIdsAndCategory(
          placeIds,
          dto.categoryId,
        )
      : new Map<
          string,
          {
            dishMediaId: string;
            reuseKind: 'completed' | 'google-import-non-completed';
          }
        >();
    if (!preflightEnabled) {
      this.logger.warn('BulkImportPreflightDisabled', 'bulkImportFromGoogle', {
        categoryId: dto.categoryId,
      });
    }
    const reusableMediaIds = [
      ...new Set(
        [...reusableMediaByPlaceId.values()].map(
          (reusableMedia) => reusableMedia.dishMediaId,
        ),
      ),
    ];
    // #829 【互換性】bulk-import は viewer を受け取らないため、既存 entry 組み立てだけ固定 viewer で既存 assembler に寄せる。
    const existingEntries =
      await this.dishMediaService.fetchDishMediaEntryItems(reusableMediaIds, {
        userId: viewerId,
      });
    const existingEntryByMediaId = new Map(
      existingEntries.items.map((entry) => [
        String(entry.dish_media.id),
        entry,
      ]),
    );
    const existingReusableEntryByPlaceId = new Map<
      string,
      {
        reuseKind: 'completed' | 'google-import-non-completed';
        entry: BulkImportDishesResponse[0];
      }
    >();
    for (const [placeId, reusableMedia] of reusableMediaByPlaceId.entries()) {
      const entry = existingEntryByMediaId.get(reusableMedia.dishMediaId);
      if (entry) {
        existingReusableEntryByPlaceId.set(placeId, {
          reuseKind: reusableMedia.reuseKind,
          entry,
        });
      }
    }

    // 各レストランに対してデータ登録処理（並列処理）
    // #829 【バグ】Text Search が同じ place を2件返すと、ID が決定論的になった今は
    // 同一 dish_media.id が2件レスポンスに載り、Cloud Task も二重に積まれる。
    // contextualContents は元の places と index で対応するため、
    // 重複除去後も必ず「元の index」を保持すること。
    // #1053 【観測】重複削減の効果は external_api_logs の Photo Media 呼び出し数で測るのが
    // 最も直接的だが、それだけだと「何件を再利用して減らせたのか」が分からない。
    // 分岐の内訳をレスポンス側にも残し、突き合わせられるようにする。
    let reusedCompletedCount = 0;
    let reusedNonCompletedCount = 0;
    let newlyCreatedCount = 0;
    let photoMediaCallCount = 0;
    let photoMediaSkippedCount = 0;

    const seenPlaceIds = new Set<string>();
    const uniquePlaces = googlePlaces.places
      .map((place, index) => ({ place, index }))
      .filter(({ place, index }) => {
        if (!place.id) return true;
        if (seenPlaceIds.has(place.id)) {
          this.logger.warn(
            'DuplicatePlaceInTextSearch',
            'bulkImportFromGoogle',
            { placeId: place.id, index },
          );
          return false;
        }
        seenPlaceIds.add(place.id);
        return true;
      });

    const processPromises = uniquePlaces.map(async ({ place, index }) => {
      try {
        const contextualContent = canUseContextual
          ? contextualContents[index]
          : undefined;

        // #636 【設計】photos: contextualContents.photos を優先、なければ place.photos にフォールバック
        const photos =
          contextualContent?.photos && contextualContent.photos.length > 0
            ? contextualContent.photos
            : place.photos || [];

        const reviews = selectGooglePlaceReviews({
          contextualReviews: contextualContent?.reviews || [],
          placeReviews: place.reviews || [],
          preferredLanguageCode: dto.languageCode,
        });

        // #1052 【観測】#636 の ContextualReviewsMissingFallbackToPlaceReviews は、
        // 両集合を候補にする実装へ変わったことで事象定義が意味を失い削除された。
        // 代替として「どちらから何件採用したか」「優先言語が何件ヒットしたか」を残す。
        // #817 の再発（現地語レビューが英語に押し出される）はこの指標で検知できる。
        this.logger.log('GooglePlaceReviewsSelected', 'bulkImportFromGoogle', {
          placeId: place.id || 'unknown',
          categoryId: dto.categoryId,
          preferredLanguageCode: dto.languageCode,
          contextualReviewsCount: contextualContent?.reviews?.length || 0,
          placeReviewsCount: place.reviews?.length || 0,
          selectedCount: reviews.length,
          preferredLanguageHitCount: reviews.filter(
            (review) =>
              normalizeLanguageCode(review.originalText?.languageCode) ===
              normalizeLanguageCode(dto.languageCode),
          ).length,
          selectedLanguageCodes: reviews.map(
            (review) => review.originalText?.languageCode || '',
          ),
        });

        if (
          (!contextualContent?.photos ||
            contextualContent.photos.length === 0) &&
          place.photos &&
          place.photos.length > 0
        ) {
          this.logger.warn(
            'ContextualPhotosMissingFallbackToPlacePhotos',
            'bulkImportFromGoogle',
            {
              placeId: place.id || 'unknown',
              dishCategoryName: dto.categoryName,
              contextualPhotosCount: contextualContent?.photos?.length || 0,
              placePhotosCount: place.photos.length,
            },
          );
        }

        // Check required fields with proper validation for latitude/longitude
        const missingFields: string[] = [];
        if (!place.id) missingFields.push('id');
        if (!place.displayName?.text) missingFields.push('displayName.text');
        if (typeof place.location?.latitude !== 'number')
          missingFields.push('location.latitude');
        if (typeof place.location?.longitude !== 'number')
          missingFields.push('location.longitude');
        if (!place.addressComponents) missingFields.push('addressComponents');

        if (missingFields.length > 0) {
          this.logger.error('InvalidPlaceData', 'bulkImportFromGoogle', {
            placeId: place.id || 'unknown',
            missingFields,
            place: JSON.stringify(place),
          });
          throw new Error(
            `Invalid place data - missing fields: ${missingFields.join(', ')}`,
          );
        }

        const existingReusableEntry = existingReusableEntryByPlaceId.get(
          place.id!,
        );
        if (existingReusableEntry?.reuseKind === 'completed') {
          // #829 【設計】completed は表示可能な既存 entry を真実源にし、Photo Media と Cloud Task を両方 skip する。
          this.logger.debug(
            'ExistingCompletedDishMediaFound',
            'bulkImportFromGoogle',
            {
              placeId: place.id!,
              categoryId: dto.categoryId,
              dishMediaId: existingReusableEntry.entry.dish_media.id,
            },
          );
          reusedCompletedCount++;
          return existingReusableEntry.entry;
        }

        const existingGoogleImportEntry =
          existingReusableEntry?.reuseKind === 'google-import-non-completed'
            ? existingReusableEntry.entry
            : undefined;

        // #1053 【課金】未完了再利用パスは、既存 media_path の実体が GCS にある限り
        // Photo Media を取り直す必要がない。写真バイナリは既に保存済みで、
        // 未完了なのは「その後の resize」だからである。
        //
        // ここを見落とすと、恒久的に resize 失敗して failed に張り付いた place が
        // bulk-import のたびに Photo Media を課金し続ける（#829 の目的に反する）。
        // 実体があるなら photoUri 無しで enqueue し、handler には download を skip させて
        // resize だけやり直させる。
        const reusableMediaPath = existingGoogleImportEntry?.dish_media
          .media_path as string | undefined;
        const canSkipPhotoMedia = reusableMediaPath
          ? await this.storage.fileExists(reusableMediaPath)
          : false;

        if (canSkipPhotoMedia) {
          this.logger.log(
            'PhotoMediaSkippedForStoredMedia',
            'bulkImportFromGoogle',
            {
              placeId: place.id!,
              categoryId: dto.categoryId,
              dishMediaId: existingGoogleImportEntry!.dish_media.id,
              mediaPath: reusableMediaPath,
              mediaProcessingStatus:
                existingGoogleImportEntry!.dish_media.media_processing_status,
            },
          );
          photoMediaSkippedCount++;
        }

        if (!canSkipPhotoMedia && (!photos || photos.length === 0)) {
          this.logger.warn('NoPhotoForPlace', 'bulkImportFromGoogle', {
            placeId: place.id!,
          });
          return null; // 写真がない場合はスキップ
        }

        // PhotoMediaUri を複数候補から取得（バイナリ取得は行わない）
        const photoMedia = canSkipPhotoMedia
          ? null
          : await this.locationsService.tryGetPhotoMedia(photos);
        if (!canSkipPhotoMedia) {
          if (!photoMedia) {
            throw new Error(`No photo URL found for place: ${place.id!}`);
          }
          photoMediaCallCount++;
        }
        const ext = getExt('image/jpeg');
        const dishMediaId =
          existingGoogleImportEntry?.dish_media.id ??
          buildGoogleImportDishMediaId(place.id!, dto.categoryId);
        // #829 【設計】未完了 Google import は既存 GCS path を維持し、同じ dish_media.id の resize 完了を目指す。
        // #1053 【バグ】新規パスの buildFileName は `${Date.now()}_${slug}` を返すため、
        // レース中の2本は dish_media.id が一致するのに media_path だけ食い違う。
        // upsert の update は空なので DB は先勝ちの path のまま残り、後勝ちが
        // アップロードした GCS オブジェクトは誰からも参照されない孤児になる。
        // dish_media.id から導出して media_path も決定論的にする。
        const mediaPath =
          existingGoogleImportEntry?.dish_media.media_path ??
          buildFullPath({
            resourceType: 'google-maps',
            usageType: 'photo',
            finalFileName: `${dishMediaId}.${ext}`,
          });

        const restaurant: SupabaseRestaurants = {
          id: existingGoogleImportEntry?.restaurant.id ?? 'unknown',
          google_place_id: place.id!,
          name:
            existingGoogleImportEntry?.restaurant.name ??
            place.displayName!.text!,
          name_language_code:
            existingGoogleImportEntry?.restaurant.name_language_code ??
            dto.languageCode,
          latitude:
            existingGoogleImportEntry?.restaurant.latitude ??
            place.location!.latitude!,
          longitude:
            existingGoogleImportEntry?.restaurant.longitude ??
            place.location!.longitude!,
          location: existingGoogleImportEntry?.restaurant.location ?? null,
          // #1053 Photo Media を skip したときは新しい photoUri が無いので既存値を維持する。
          image_url:
            photoMedia?.photoUri ??
            existingGoogleImportEntry?.restaurant.image_url ??
            '',
          image_path: mediaPath,
          address_components:
            existingGoogleImportEntry?.restaurant.address_components ??
            JSON.parse(JSON.stringify(place.addressComponents)),
          plus_code:
            existingGoogleImportEntry?.restaurant.plus_code ??
            (place.plusCode
              ? JSON.parse(JSON.stringify(place.plusCode))
              : null),
          created_at:
            existingGoogleImportEntry?.restaurant.created_at ??
            new Date().toISOString(),
        };

        const dish: SupabaseDishes = {
          id: existingGoogleImportEntry?.dish.id ?? 'unknown',
          restaurant_id: restaurant.id,
          category_id: dto.categoryId,
          name: existingGoogleImportEntry?.dish.name ?? dto.categoryName,
          created_at:
            existingGoogleImportEntry?.dish.created_at ??
            new Date().toISOString(),
          updated_at:
            existingGoogleImportEntry?.dish.updated_at ??
            new Date().toISOString(),
          lock_no: existingGoogleImportEntry?.dish.lock_no ?? 0,
        };

        const dishMedia: SupabaseDishMedia = {
          // #829 【バグ】randomUUID だと、1本目の handler が commit する前に2本目の
          // bulk-import が走った場合に別 ID が採番され、dish_reviews が二重登録される。
          // (placeId, categoryId) から決定論的に導出し、upsert / skipDuplicates を
          // リクエスト間でも効かせる。
          id: dishMediaId,
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          media_path: mediaPath,
          media_type:
            existingGoogleImportEntry?.dish_media.media_type ?? 'image',
          thumbnail_path:
            existingGoogleImportEntry?.dish_media.thumbnail_path ?? mediaPath,
          video_duration_ms: null,
          media_processing_status: 'processing', // #511 【設計】後続のジョブでリサイズ処理を行う
          thumbnail_processing_status: 'processing',
          created_at:
            existingGoogleImportEntry?.dish_media.created_at ??
            new Date().toISOString(),
          updated_at: new Date().toISOString(),
          lock_no: existingGoogleImportEntry?.dish_media.lock_no ?? 0,
        };

        if (existingGoogleImportEntry) {
          // #829 【設計】この経路は既存 ID・既存 media_path・既存 review を payload へ
          // 注入するため副作用が大きい。件数と status を必ず残し、failed ループや
          // 課金残存を後からログで数えられるようにする。
          this.logger.log(
            'ExistingGoogleImportDishMediaReused',
            'bulkImportFromGoogle',
            {
              placeId: place.id!,
              categoryId: dto.categoryId,
              dishMediaId: existingGoogleImportEntry.dish_media.id,
              mediaProcessingStatus:
                existingGoogleImportEntry.dish_media.media_processing_status,
              thumbnailProcessingStatus:
                existingGoogleImportEntry.dish_media
                  .thumbnail_processing_status,
              reusedReviewCount: existingGoogleImportEntry.dish_reviews.length,
            },
          );
        }

        const googleReviews: SupabaseDishReviews[] = reviews.map((review) => ({
          // #829 【バグ】review ID も決定論的に導出し、リクエストを跨いだ重複を防ぐ
          id: buildGoogleImportDishReviewId(
            place.id!,
            dto.categoryId,
            review.originalText?.text || '',
            review.authorAttribution?.uri || '',
            review.rating || 0,
          ),
          dish_id: dish.id,
          user_id: null, // Google からのインポートなので null
          // #817 【設計】Google Places の originalText は投稿者が書いた元言語の本文。
          // dish_reviews.comment には翻訳済み text ではなく元本文を保存し、
          // original_language_code にはその元本文の言語を保存する。
          // UGC 投稿保存に揃える方針。
          comment: review.originalText?.text || '',
          comment_tsv: null,
          original_language_code: review.originalText?.languageCode || '',
          rating: review.rating || 0,
          price_cents: null,
          currency_code: null,
          created_dish_media_id: dishMedia.id,
          imported_user_name: review.authorAttribution?.displayName || null,
          imported_user_avatar: review.authorAttribution?.photoUri || null,
          created_at: new Date().toISOString(),
        }));

        // #829 【設計】未完了 Google import の再処理では既存 review ID を渡し、handler 側の skipDuplicates と合わせて retry を no-op 化する。
        // #1053 【バグ】既存 review だけを渡すと、今回 Google が返した新しいレビューが毎回捨てられる。
        // 既存 entry の dish_reviews は `take: reviewLimit`（既定 6）で切られてもいるため、
        // 前回インポート時に Google が 0 件を返していた place は、以後レビューが付いても永久に登録されない。
        // ID は決定論的なので、両者を id で union すれば skipDuplicates が既存分を no-op にし、
        // 差分だけが追加される。
        const dishReviews: SupabaseDishReviews[] = existingGoogleImportEntry
          ? this.mergeDishReviewsById(
              this.toSupabaseDishReviews(
                existingGoogleImportEntry.dish_reviews,
              ),
              googleReviews,
            )
          : googleReviews;

        // 非同期ジョブをキューに投入
        // #1053 photoUri が空配列なら handler は download を skip し、upsert と resize だけやり直す。
        await this.enqueueCreateDishMediaEntryJob({
          restaurant,
          dish,
          dishMedia,
          dishReviews,
          placeId: place.id!,
          photoUri: photoMedia?.photoUri,
        });

        if (existingGoogleImportEntry) {
          reusedNonCompletedCount++;
          // #829 【互換性】未完了 row はフロントの polling 条件に乗りにくいため、同期レスポンスだけ Google Photo URL で completed 相当にする。
          // #1053 Photo Media を skip した場合は新しい URL が無いが、GCS に実体がある
          // ことは確認済みなので、assembler が組み立てた既存 URL をそのまま返せばよい。
          return photoMedia
            ? this.buildGoogleImportRetryEntry(
                existingGoogleImportEntry,
                photoMedia.photoUri,
              )
            : existingGoogleImportEntry;
        }

        newlyCreatedCount++;

        const BulkImportDishesResponseEntry: BulkImportDishesResponse[0] = {
          restaurant: {
            ...restaurant,
            imageUrls: {
              // canSkipPhotoMedia は existingGoogleImportEntry がある場合のみ true になるため、
              // 新規作成パスに到達した時点で photoMedia は必ず取得済み。
              sm: photoMedia!.photoUri,
              md: photoMedia!.photoUri,
            },
          },
          dish: {
            ...dish,
            reviewCount: dishReviews.length,
            averageRating:
              dishReviews.length > 0
                ? dishReviews.reduce((sum, r) => sum + r.rating, 0) /
                  dishReviews.length
                : 0,
          },
          dish_media: {
            ...dishMedia,
            media_processing_status: 'completed', // クライアント側には処理済みの画像を返す
            thumbnail_processing_status: 'completed',
            mediaUrl: photoMedia!.photoUri,
            thumbnailImageUrl: photoMedia!.photoUri,
            renderType: 'stored_media',
            externalEmbed: null,
            isMine: false, // インポートなので自分のものではない
            isSaved: false, // 初期状態では保存されていない
            isLiked: false, // 初期状態ではいいねされていない
            likeCount: 0, // 初期状態ではいいね数は0
          },
          dish_reviews: dishReviews.map((r) => ({
            ...r,
            username: r.imported_user_name || 'Anonymous', // ユーザー名がない場合は 'Anonymous' とする
            isLiked: false, // 初期状態ではいいねされていない
            likeCount: 0, // 初期状態ではいいね数は 0
          })),
        };
        return BulkImportDishesResponseEntry;
      } catch (error) {
        this.logger.error('BulkImportPlaceError', 'bulkImportFromGoogle', {
          placeId: place.id || 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // 1つのレストランでエラーが起きても処理を続行
        return null;
      }
    });

    // 並列処理を実行
    const processResults = await Promise.allSettled(processPromises);

    // 成功した結果のみを抽出
    const successfulResults = processResults
      .filter(
        (result): result is PromiseFulfilledResult<any> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);

    results.push(...successfulResults);

    // #1053 【観測】削減効果は external_api_logs の Photo Media 呼び出し数と
    // 突き合わせて評価する。内訳が無いと「減ったのは再利用のおかげか、
    // そもそも検索結果が少なかっただけか」を区別できない。
    this.logger.log('BulkImportCompleted', 'bulkImportFromGoogle', {
      importedCount: results.length,
      totalPlaces: googlePlaces.places?.length,
      categoryId: dto.categoryId,
      reusedCompletedCount,
      reusedNonCompletedCount,
      newlyCreatedCount,
      photoMediaCallCount,
      photoMediaSkippedCount,
    });

    return results;
  }

  private buildGoogleImportRetryEntry(
    entry: DishMediaEntry,
    photoUri: string,
  ): DishMediaEntry {
    // #829 【互換性】DB の processing 状態は維持しつつ、bulk-import の既存レスポンス契約に合わせて表示用 URL を返す。
    return {
      ...entry,
      restaurant: {
        ...entry.restaurant,
        image_url: photoUri,
        imageUrls: {
          sm: photoUri,
          md: photoUri,
        },
      },
      dish_media: {
        ...entry.dish_media,
        media_processing_status: 'completed',
        thumbnail_processing_status: 'completed',
        mediaUrl: photoUri,
        thumbnailImageUrl: photoUri,
      },
    };
  }

  private toSupabaseDishReviews(
    reviews: DishMediaEntry['dish_reviews'],
  ): SupabaseDishReviews[] {
    // #829 【設計】assembler が付与した表示用 field は handler payload には戻さない。
    return reviews.map((review) => {
      const { username, isLiked, likeCount, ...supabaseReview } = review;
      return supabaseReview;
    });
  }

  /**
   * 非同期ジョブをキューに投入
   */
  private async enqueueCreateDishMediaEntryJob({
    restaurant,
    dish,
    dishMedia,
    dishReviews,
    placeId,
    photoUri,
  }: {
    restaurant: SupabaseRestaurants;
    dish: SupabaseDishes;
    dishMedia: SupabaseDishMedia;
    dishReviews: SupabaseDishReviews[];
    placeId: string;
    photoUri?: string;
  }) {
    // 非同期ジョブ用のペイロード作成
    const jobId = `dish-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const idempotencyKey = `${placeId}-${dish.category_id}`;

    const jobPayload: CreateDishMediaEntryJobPayload = {
      jobId,
      idempotencyKey,
      // #1053 GCS に実体がある再利用パスでは空配列。handler は download を skip する。
      photoUri: photoUri ? [photoUri] : [],
      restaurants: restaurant,
      dishes: dish,
      dish_media: dishMedia,
      dish_reviews: dishReviews,
    };

    // 非同期ジョブをキューに投入（写真の実体取得・保存のため）
    // #1053 【バグ】以前は Promise を await も catch もしていなかった。
    // enqueueCreateDishMediaEntry は createTask 失敗時に reject するため、
    // 同期 try/catch では捕まえられず unhandled rejection になる
    // （Node 15+ の既定ではプロセスが落ちる）。必ず await して握る。
    try {
      await this.cloudTasksService.enqueueCreateDishMediaEntry(jobPayload);
      this.logger.debug('AsyncJobEnqueued', 'bulkImportFromGoogle', {
        jobId,
        placeId,
        hasPhotoUri: !!photoUri,
      });
    } catch (error) {
      // #1053 enqueue に失敗すると「レスポンスで返した dish_media.id が永久に DB に存在しない」
      // orphan response になる。同期レスポンスは継続するが、必ず error として残す。
      this.logger.error('AsyncJobEnqueueError', 'bulkImportFromGoogle', {
        jobId,
        placeId,
        dishMediaId: dishMedia.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * #1053 既存 review と Google の新規 review を union する。
   *
   * ID は (placeId, categoryId, 本文, 投稿者, rating) から決定論的に導出されるため、
   * #829 以降に作られた行は id だけで突き合わせできる。
   *
   * ただし **#829 より前に作られた行の id は `randomUUID()` 由来**で、決定論 ID とは
   * 一致しない。本メソッドが復旧対象にしているのはまさにその旧 failed/processing 行なので、
   * id だけで照合すると同じレビューが別 id で payload に入り、handler の
   * `createMany({ skipDuplicates })` も主キーが違うため弾けず、**reviewCount と
   * averageRating が水増しされる**。
   *
   * そこで内容キー（本文 + 投稿者名 + rating）でも照合する。
   * 決定論 ID は `authorAttribution.uri` を使うが、これは DB に保存されていないため
   * 既存行から再計算できない。両側に存在する列だけでキーを作る必要がある。
   *
   * 内容キーの照合は Google import 由来（`user_id === null`）に限る。
   * ユーザー投稿レビューを本文一致で潰すと、別人の同文投稿が消える。
   */
  private mergeDishReviewsById(
    existing: SupabaseDishReviews[],
    incoming: SupabaseDishReviews[],
  ): SupabaseDishReviews[] {
    const contentKey = (review: SupabaseDishReviews) =>
      [
        review.comment ?? '',
        review.imported_user_name ?? '',
        review.rating ?? '',
      ].join('\u0000');

    const byId = new Map(existing.map((review) => [review.id, review]));
    const seenContent = new Set(
      existing
        .filter((review) => review.user_id === null)
        .map((review) => contentKey(review)),
    );

    for (const review of incoming) {
      if (byId.has(review.id)) continue;
      if (review.user_id === null && seenContent.has(contentKey(review))) {
        continue;
      }
      byId.set(review.id, review);
      if (review.user_id === null) seenContent.add(contentKey(review));
    }
    return [...byId.values()];
  }
}
