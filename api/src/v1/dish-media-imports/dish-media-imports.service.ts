// api/src/v1/dish-media-imports/dish-media-imports.service.ts
//
// #1399 SNS の URL を解決して**候補だけ**を返す。
//
// ## ⚠️ このサービスは DB へ 1 行も書かない
//
// #1399 には未解決の Blocker (B-1)「import した他人の SNS 投稿が、他ユーザーの検索フィードと
// 外部共有ページに公開されてしまう」がある（`dish_media.repository.ts` の `base_candidates` は
// 所有者で絞っておらず、`dish_media` に可視性の列も無い）。オーナーの判断が出るまで
// **保存（dish_media / dish_media_external_embeddings / reactions への書き込み）はスコープ外**。
// ここは読み取りと外部取得だけを行う。
//
// ## 流れ
//
// ```
// parseSnsUrl(url)                     ← shared/utils/snsUrl.ts。判定は書き足さない
//   ├ null            → unsupported_url（候補ゼロ＋理由）
//   ├ kind:"shortlink" → SafeFetch で展開 → もう一度 parseSnsUrl
//   └ kind:"content"   → そのまま
// oEmbed でメタデータ取得（TikTok / YouTube。Instagram は取れない前提で縮退）
//   └ 失敗 → 候補ゼロ＋理由（**例外を投げっぱなしにしない**）
// matchDishCategories(texts, 辞書)      ← shared/utils/dishCategoryMatch.ts
// matchRestaurantNames(texts, 近傍店舗) ← shared/utils/restaurantNameMatch.ts
//                                        lat/lng/radius が渡されたときだけ
// ```
//
// **`null` は返さない。** 対応外 URL・oEmbed 失敗・メタデータ空のいずれも
// «候補ゼロ＋理由» を返して、呼び出し側が «手入力へ縮退» できる形にする。

import { BadRequestException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { AppLoggerService } from '../../core/logger/logger.service';
import { CLS_KEY_APP_VERSION } from '../../core/cls/cls.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { SafeFetchService } from '../../core/safe-fetch/safe-fetch.service';
import { SafeFetchError } from '../../core/safe-fetch/safe-fetch.types';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { DishCategoryVariantDictionaryService } from './dish-category-variant-dictionary.service';
import { SnsOembedService, type SnsMetadata } from './sns-oembed.service';

import { Prisma } from '../../../../shared/prisma/client';
import {
  parseSnsUrl,
  type SnsUrlContent,
  type SnsUrlParseResult,
} from '../../../../shared/utils/snsUrl';
import { matchDishCategoriesWithIndex } from '../../../../shared/utils/dishCategoryMatch';
import { matchRestaurantNames } from '../../../../shared/utils/restaurantNameMatch';
import type { ExtractedText } from '../../../../shared/utils/textNormalize';
import type {
  CreateDishMediaImportDto,
  ResolveDishMediaImportDto,
} from '@shared/v1/dto';
import type {
  CreateDishMediaImportResponse,
  ResolveDishMediaImportDishCategoryCandidate,
  ResolveDishMediaImportReason,
  ResolveDishMediaImportResponse,
  ResolveDishMediaImportRestaurantCandidate,
  ResolveDishMediaImportRestaurantSearchReason,
  ResolveDishMediaImportStatus,
} from '@shared/v1/res';

/**
 * 照合対象として引く近傍店舗の件数。
 *
 * `QueryRestaurantsDto.limit` の上限（100）に合わせてある。
 * `matchRestaurantNames` 側も 200 件で頭打ちなので、これ以上増やしても候補は増えない。
 */
const AREA_RESTAURANT_LIMIT = 100;

/** `author_name` を `q` に投げるときの件数 */
const AUTHOR_NAME_RESTAURANT_LIMIT = 20;

/**
 * `author_name` を店名検索へ投げる最短の長さ。
 *
 * 1 文字だと `restaurants.name ILIKE '%x%'` が実質全件に当たる。
 * 上限 64 は `QueryRestaurantsDto.q` の `@MaxLength(64)` と揃えてある。
 */
const AUTHOR_NAME_QUERY_MIN_LENGTH = 2;
const AUTHOR_NAME_QUERY_MAX_LENGTH = 64;

/** 返す候補の既定件数 */
const DEFAULT_CANDIDATE_LIMIT = 5;

@Injectable()
export class DishMediaImportsService {
  constructor(
    private readonly safeFetch: SafeFetchService,
    private readonly oembed: SnsOembedService,
    private readonly dictionary: DishCategoryVariantDictionaryService,
    private readonly dishCategoriesRepo: DishCategoriesRepository,
    private readonly restaurantsRepo: RestaurantsRepository,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly cls: ClsService,
  ) {}

  /**
   * #1399 SNS の URL から取り込んだ 1 件を **保存する**。
   *
   * ## URL はここでもう一度解決し直す
   *
   * クライアントが送ってきた provider / externalContentId をそのまま信じない。
   * 信じると、任意の provider・任意の id の行を作れてしまう。`resolve` を通してから
   * その結果だけを保存する（多少無駄でも、保存の入口は 1 本にしておく）。
   *
   * ## 冪等である
   *
   * 自然キー `(provider, external_content_id, dish_id)` の UNIQUE により、同じ SNS 投稿を
   * 同じ料理へ二重に取り込むことはない。既に在れば **その `dish_media` を指すだけ**で、
   * 新しい行は作らない。そのうえで `reactions(save)` は呼び出したユーザーの分を必ず用意する。
   * これで「他人が先に取り込んだ投稿を、自分の食べたいへ入れる」が成立する。
   *
   * ## dish_media.user_id は NULL のままにする
   *
   * 取り込んだメディアの投稿者は **アプリのユーザーではない**（SNS 側の投稿者である）。
   * `user_id` を取り込んだ人にすると「自分が撮った写真」と同じ扱いになり、`isMine` や
   * payouts の対象にまで乗ってしまう。ユーザーとの紐付けは `reactions(save)` が持つ
   * （＝「食べたい」）。これは #1375 の状態導出（save=食べたい / dish_reviews=食べた）と同じ形である。
   */
  async create(
    dto: CreateDishMediaImportDto,
    userId: string,
  ): Promise<CreateDishMediaImportResponse> {
    const resolved = await this.resolve({ url: dto.url });

    if (resolved.status === 'unsupported') {
      throw new BadRequestException(`IMPORT_UNSUPPORTED:${resolved.reason}`);
    }
    if (resolved.status === 'unavailable') {
      // 相手が消えている。取り込ませない（`unknown` とは混ぜないこと。#1399 設計 §3-7）
      throw new BadRequestException(`IMPORT_UNAVAILABLE:${resolved.reason}`);
    }

    const { provider, externalContentId, canonicalUrl } = resolved.source;
    if (!provider || !externalContentId || !canonicalUrl) {
      // status が ok / unknown ならここは埋まっている。埋まっていなければ契約違反
      throw new BadRequestException('IMPORT_UNSUPPORTED:unsupported_url');
    }

    const appVersion = this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';

    return this.prisma.withTransaction(async (tx) => {
      /* 1. dish（店舗 × 料理カテゴリ）。無ければ作る */
      const dish = await tx.dishes.upsert({
        where: {
          restaurant_id_category_id: {
            restaurant_id: dto.restaurantId,
            category_id: dto.dishCategoryId,
          },
        },
        create: {
          restaurant_id: dto.restaurantId,
          category_id: dto.dishCategoryId,
        },
        update: {},
      });

      /* 2. 同じ SNS 投稿が同じ料理へ既に取り込まれていないか */
      const existing = await tx.dish_media_external_embeddings.findFirst({
        where: {
          provider,
          external_content_id: externalContentId,
          dish_id: dish.id,
        },
        select: { dish_media_id: true },
      });

      let dishMediaId = existing?.dish_media_id ?? null;
      const created = dishMediaId === null;

      if (dishMediaId === null) {
        /* 3. dish_media。実体は自ストレージに無いので media_path は NULL */
        const media = await tx.dish_media.create({
          data: {
            dish_id: dish.id,
            // 投稿者はアプリのユーザーではない（上のコメント参照）
            user_id: null,
            media_path: null,
            media_type: 'image',
            // NOT NULL なので空文字を入れる。external_embed では自ストレージに実体が無く、
            // 表示は dish_media_external_embeddings.thumbnail_url →
            // 料理カテゴリ画像 の順で解決する（assembler / resolveMyDishThumbnailUrl）
            thumbnail_path: '',
            media_processing_status: 'completed',
            thumbnail_processing_status: 'completed',
            render_type: 'external_embed',
          },
          select: { id: true },
        });
        dishMediaId = media.id;

        /* 4. 埋め込みの実体。embed_html は保存しない（正本 §2 / #1273 §14） */
        await tx.dish_media_external_embeddings.create({
          data: {
            dish_media_id: dishMediaId,
            dish_id: dish.id,
            provider,
            external_content_id: externalContentId,
            canonical_url: canonicalUrl,
            // 取り込んだ直後は «生きている» と確認できた状態にはない。
            // oEmbed が取れた（status='ok'）ときだけ available と言い切る
            embed_status: resolved.status === 'ok' ? 'available' : 'unknown',
            last_verified_at: resolved.status === 'ok' ? new Date() : null,
            // サムネイルは複製せず参照する（権利調査の結論。migration 20260822T0000 参照）
            thumbnail_url: resolved.metadata.thumbnailUrl,
          },
        });
      }

      /* 5. 「食べたい」= reactions(save)。ここがユーザーとの唯一の紐付けである */
      const alreadySaved = await tx.reactions.findUnique({
        where: {
          user_id_target_type_target_id_action_type: {
            user_id: userId,
            target_type: 'dish_media',
            target_id: dishMediaId,
            action_type: 'save',
          },
        },
        select: { id: true },
      });

      if (!alreadySaved) {
        await tx.reactions.create({
          data: {
            user_id: userId,
            target_type: 'dish_media',
            target_id: dishMediaId,
            action_type: 'save',
            created_at: new Date(),
            created_version: appVersion,
            lock_no: 0,
          },
        });
      }

      return {
        dishMediaId,
        dishId: dish.id,
        created,
        saved: !alreadySaved,
      };
    });
  }

  async resolve(
    dto: ResolveDishMediaImportDto,
  ): Promise<ResolveDishMediaImportResponse> {
    const limit = dto.limit ?? DEFAULT_CANDIDATE_LIMIT;

    /* 1. URL の解釈。判定ロジックはここに書かない（`shared/utils/snsUrl.ts` が正本） */
    const parsed = parseSnsUrl(dto.url);
    if (parsed === null) {
      this.logger.debug('SnsImportUnsupportedUrl', 'resolve', {
        length: dto.url.length,
      });
      return this.emptyResponse(
        'unsupported',
        'unsupported_url',
        null,
        false,
        dto,
      );
    }

    /* 2. 短縮 URL なら展開して、もう一度同じ判定に通す */
    let content: SnsUrlContent;
    let expandedFromShortlink = false;

    if (parsed.kind === 'shortlink') {
      const expanded = await this.expandShortlink(parsed);
      if (expanded.content === null) {
        return this.emptyResponse(
          'unsupported',
          expanded.reason,
          null,
          true,
          dto,
        );
      }
      content = expanded.content;
      expandedFromShortlink = true;
    } else {
      content = parsed;
    }

    /* 3. provider 別の公式 oEmbed */
    const outcome = await this.oembed.fetchMetadata(content);

    if (outcome.status === 'unavailable') {
      return this.emptyResponse(
        'unavailable',
        'metadata_content_unavailable',
        content,
        expandedFromShortlink,
        dto,
      );
    }
    if (outcome.status === 'unknown') {
      // Instagram（取得手段が無い）も、oEmbed の 5xx / タイムアウトもここへ来る。
      // **どちらも「取り込みは続行してよい」状態**なので、埋め込みに要る情報は返し切る。
      return this.emptyResponse(
        'unknown',
        outcome.kind === 'provider_unsupported'
          ? 'metadata_provider_unsupported'
          : 'metadata_fetch_failed',
        content,
        expandedFromShortlink,
        dto,
      );
    }

    const metadata = outcome.metadata;
    const texts = this.buildExtractedTexts(content, metadata);

    /* 4. 料理カテゴリ候補 */
    const dishCategoryOutcome =
      texts.length === 0
        ? { candidates: [], prefillDishCategoryId: null }
        : await this.findDishCategoryCandidates(texts, limit);

    /* 5. 店舗候補（lat/lng/radius が渡されたときだけ） */
    const restaurantOutcome = await this.findRestaurantCandidates(
      dto,
      texts,
      metadata.authorName,
      limit,
    );

    const reason: ResolveDishMediaImportReason =
      texts.length === 0 && metadata.authorName === null
        ? 'metadata_empty'
        : 'resolved';

    return {
      status: 'ok',
      reason,
      source: this.buildSource(content, expandedFromShortlink),
      metadata: {
        title: metadata.title,
        authorName: metadata.authorName,
        authorUrl: metadata.authorUrl,
        thumbnailUrl: metadata.thumbnailUrl,
        extractedTexts: texts.map((text) => ({
          field: text.field,
          text: text.text,
        })),
      },
      candidates: {
        dishCategories: dishCategoryOutcome.candidates,
        restaurants: restaurantOutcome.candidates,
      },
      prefill: {
        dishCategoryId: dishCategoryOutcome.prefillDishCategoryId,
        restaurantId: restaurantOutcome.prefillRestaurantId,
      },
      restaurantSearch: {
        performed: restaurantOutcome.performed,
        reason: restaurantOutcome.reason,
        scannedCount: restaurantOutcome.scannedCount,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  短縮 URL の展開                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * `vm.tiktok.com/{code}` などを展開して投稿 URL を確定させる。
   *
   * **各ホップの許可判定に `parseSnsUrl()` をそのまま使う。** ホスト allowlist を
   * SafeFetch 側にもう 1 つ持つと、対象 provider を増やしたときに片方だけ直す事故が起きる。
   * `parseSnsUrl()` が `null` を返すホップ（例: ログインページへの誘導）は、そこで打ち切る。
   *
   * `stopAt` で「解決先が既に投稿 URL の形になったら、そこへリクエストせず終わる」ようにして
   * ある。展開に必要なのは URL であって、投稿ページの本文ではない。
   */
  private async expandShortlink(
    shortlink: Extract<SnsUrlParseResult, { kind: 'shortlink' }>,
  ): Promise<{
    content: SnsUrlContent | null;
    reason: ResolveDishMediaImportReason;
  }> {
    const isSnsUrl = (url: URL) => parseSnsUrl(url.href) !== null;
    const isResolvedContent = (url: URL) =>
      parseSnsUrl(url.href)?.kind === 'content';

    try {
      const chain = await this.safeFetch.resolveRedirectChain(
        shortlink.expandUrl,
        {
          apiName: `${shortlink.provider} shortlink`,
          functionName: 'expandShortlink',
          allowHop: isSnsUrl,
          stopAt: isResolvedContent,
        },
      );

      const resolved = parseSnsUrl(chain.finalUrl);
      if (resolved === null || resolved.kind !== 'content') {
        this.logger.warn('SnsShortlinkTargetUnsupported', 'expandShortlink', {
          provider: shortlink.provider,
          hops: chain.hops.length,
          finalStatus: chain.finalStatus,
        });
        return { content: null, reason: 'shortlink_target_unsupported' };
      }

      return { content: resolved, reason: 'resolved' };
    } catch (error) {
      this.logger.warn('SnsShortlinkExpansionFailed', 'expandShortlink', {
        provider: shortlink.provider,
        kind: error instanceof SafeFetchError ? error.kind : 'unknown_error',
      });
      return { content: null, reason: 'shortlink_expansion_failed' };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  抽出テキスト                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * 候補生成に使うテキストを組む。**`author_name` は入れない。**
   *
   * 投稿者名に料理名が入っていることは多い（「ラーメン太郎」）が、それは
   * 「この投稿が味噌ラーメンである」根拠にならない（設計 §4-3）。
   * `author_name` は**店舗照合の方でだけ**使う。
   *
   * ハッシュタグをここで切り出さないのは、`matchDishCategories` が正規化後のテキストから
   * 自分で `#タグ` を拾うため。2 か所で切り出すと、片方だけ規則が変わったときにずれる。
   */
  private buildExtractedTexts(
    content: SnsUrlContent,
    metadata: SnsMetadata,
  ): ExtractedText[] {
    if (metadata.title === null) return [];

    // TikTok の `title` はキャプション本文（ハッシュタグ込み）、YouTube の `title` は動画題名。
    // 由来が違うので field を分けておく（信頼度の調整はしていないが、根拠のログで区別できる）
    const field: ExtractedText['field'] =
      content.provider === 'tiktok' ? 'caption' : 'title';
    return [{ field, text: metadata.title }];
  }

  /* ------------------------------------------------------------------ */
  /*  料理カテゴリ候補                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 料理カテゴリ候補と prefill を**一度の照合で**求める。
   *
   * `prefillDishCategoryId` を別途取り直さないのは、照合を 2 回走らせないためだけでなく、
   * 「候補の切り詰め前の全候補で prefill を判断する」という `matchDishCategories` 側の
   * 約束を、呼び出し側で崩さないためでもある。
   */
  private async findDishCategoryCandidates(
    texts: ExtractedText[],
    limit: number,
  ): Promise<{
    candidates: ResolveDishMediaImportDishCategoryCandidate[];
    prefillDishCategoryId: string | null;
  }> {
    const index = await this.dictionary.getIndex();
    const matched = matchDishCategoriesWithIndex(texts, index, {
      maxCandidates: limit,
    });

    if (matched.candidates.length === 0) {
      return {
        candidates: [],
        prefillDishCategoryId: matched.prefillDishCategoryId,
      };
    }

    const categories = await this.dishCategoriesRepo.findDishCategoriesByIds(
      matched.candidates.map((candidate) => candidate.dishCategoryId),
    );
    const byId = new Map(categories.map((category) => [category.id, category]));

    return {
      candidates: matched.candidates.map((candidate) => {
        const category = byId.get(candidate.dishCategoryId);
        return {
          dishCategoryId: candidate.dishCategoryId,
          labelEn: category?.label_en ?? null,
          labels: this.toLabelMap(category?.labels),
          imageUrl: category?.image_url ?? null,
          confidence: candidate.confidence,
          rank: candidate.rank,
        };
      }),
      prefillDishCategoryId: matched.prefillDishCategoryId,
    };
  }

  /** `dish_categories.labels` は Json。値が文字列の要素だけを通す（推測で埋めない） */
  private toLabelMap(labels: unknown): Record<string, string> | null {
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels))
      return null;

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      labels as Record<string, unknown>,
    )) {
      if (typeof value === 'string') result[key] = value;
    }
    return Object.keys(result).length === 0 ? null : result;
  }

  /* ------------------------------------------------------------------ */
  /*  店舗候補                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * 店舗候補を出す。**エリアが渡されたときだけ `restaurants` を引く。**
   *
   * SNS の URL には座標が無いので、エリアは呼び出し側が渡す（設計 骨子 Q-3）。
   * 渡されなければ候補は空で返す。**これは失敗ではなく既定の状態**であり、
   * 呼び出し側は「見つかりませんでした」ではなく「地図から店を選んでください」を出すこと（設計 §5-3）。
   *
   * 引き方は 2 本立て。
   *  - **エリア内の店舗を一覧で取る**（`q` なし）… `matchRestaurantNames` が
   *    「店名がキャプションに含まれるか」を見る。**店名側から当てにいく**方向（設計 §5-4）
   *  - **`author_name` を `q` に投げる**… 店の公式アカウントのケース。
   *    エリア一覧の上限から漏れた店を拾うためで、**これ単独では prefill されない**
   *    （`matchRestaurantNames` が `author-name` だけの候補を prefill から外している）
   */
  private async findRestaurantCandidates(
    dto: ResolveDishMediaImportDto,
    texts: ExtractedText[],
    authorName: string | null,
    limit: number,
  ): Promise<{
    candidates: ResolveDishMediaImportRestaurantCandidate[];
    prefillRestaurantId: string | null;
    performed: boolean;
    reason: ResolveDishMediaImportRestaurantSearchReason;
    scannedCount: number;
  }> {
    const empty = (reason: ResolveDishMediaImportRestaurantSearchReason) => ({
      candidates: [],
      prefillRestaurantId: null,
      performed: false,
      reason,
      scannedCount: 0,
    });

    const provided = [dto.lat, dto.lng, dto.radius].filter(
      (value) => typeof value === 'number',
    ).length;
    if (provided === 0) return empty('area_not_provided');
    if (provided < 3) {
      // 一部だけ渡すのは呼び出し側の組み立てミス。400 にはせず、区別できる理由で返す
      this.logger.warn('SnsImportAreaIncomplete', 'findRestaurantCandidates', {
        provided,
      });
      return empty('area_incomplete');
    }
    if (texts.length === 0 && authorName === null)
      return empty('no_extracted_text');

    const lat = dto.lat as number;
    const lng = dto.lng as number;
    const radius = dto.radius as number;

    const rows = await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        const area = await this.restaurantsRepo.searchNearbyRestaurants(tx, {
          lat,
          lng,
          radius,
          limit: AREA_RESTAURANT_LIMIT,
        });

        const authorQuery = this.buildAuthorNameQuery(authorName);
        if (authorQuery === null) return area;

        const byAuthor = await this.restaurantsRepo.searchNearbyRestaurants(
          tx,
          {
            lat,
            lng,
            radius,
            q: authorQuery,
            limit: AUTHOR_NAME_RESTAURANT_LIMIT,
          },
        );
        return [...area, ...byAuthor];
      },
    );

    const seen = new Set<string>();
    const searchCandidates: { id: string; name: string }[] = [];
    for (const row of rows) {
      if (seen.has(row.restaurant.id)) continue;
      seen.add(row.restaurant.id);
      searchCandidates.push({
        id: row.restaurant.id,
        name: row.restaurant.name,
      });
    }

    const matched = matchRestaurantNames(
      { texts, candidates: searchCandidates, authorName },
      { maxCandidates: limit },
    );

    const byId = new Map(
      rows.map((row) => [row.restaurant.id, row.restaurant]),
    );

    return {
      candidates: matched.candidates.map((candidate) => {
        const restaurant = byId.get(candidate.restaurantId);
        return {
          restaurantId: candidate.restaurantId,
          name: candidate.name,
          googlePlaceId: restaurant?.google_place_id ?? '',
          latitude: restaurant?.latitude ?? 0,
          longitude: restaurant?.longitude ?? 0,
          confidence: candidate.confidence,
          rank: candidate.rank,
        };
      }),
      prefillRestaurantId: matched.prefillRestaurantId,
      performed: true,
      reason: 'searched',
      scannedCount: searchCandidates.length,
    };
  }

  /** `author_name` を `q` として使ってよい形に整える。使えないなら `null` */
  private buildAuthorNameQuery(authorName: string | null): string | null {
    if (authorName === null) return null;

    const trimmed = authorName.trim();
    if (trimmed.length < AUTHOR_NAME_QUERY_MIN_LENGTH) return null;
    if (trimmed.length > AUTHOR_NAME_QUERY_MAX_LENGTH) return null;

    return trimmed;
  }

  /* ------------------------------------------------------------------ */
  /*  レスポンスの組み立て                                               */
  /* ------------------------------------------------------------------ */

  private buildSource(
    content: SnsUrlContent | null,
    expandedFromShortlink: boolean,
  ): ResolveDishMediaImportResponse['source'] {
    return {
      provider: content?.provider ?? null,
      externalContentId: content?.externalContentId ?? null,
      canonicalUrl: content?.canonicalUrl ?? null,
      mediaIndex: content?.mediaIndex ?? null,
      requiresShortsCheck: content?.requiresShortsCheck === true,
      expandedFromShortlink,
    };
  }

  /**
   * 候補ゼロ＋理由。**`null` を返さないための共通の出口。**
   *
   * `source` は分かっているところまで埋める。provider と `canonicalUrl` さえ返れば
   * 呼び出し側は埋め込み表示までは進められる（Instagram の縮退がまさにこれ）。
   */
  private emptyResponse(
    status: ResolveDishMediaImportStatus,
    reason: ResolveDishMediaImportReason,
    content: SnsUrlContent | null,
    expandedFromShortlink: boolean,
    dto: ResolveDishMediaImportDto,
  ): ResolveDishMediaImportResponse {
    const hasArea = [dto.lat, dto.lng, dto.radius].every(
      (value) => typeof value === 'number',
    );

    return {
      status,
      reason,
      source: this.buildSource(content, expandedFromShortlink),
      metadata: {
        title: null,
        authorName: null,
        authorUrl: null,
        thumbnailUrl: null,
        extractedTexts: [],
      },
      candidates: { dishCategories: [], restaurants: [] },
      prefill: { dishCategoryId: null, restaurantId: null },
      restaurantSearch: {
        performed: false,
        // 照合するテキストが無いので、エリアが渡されていても引かない（DB を無駄に叩かない）
        reason: hasArea ? 'no_extracted_text' : 'area_not_provided',
        scannedCount: 0,
      },
    };
  }
}
