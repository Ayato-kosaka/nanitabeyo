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
// メタデータ取得（TikTok / YouTube = oEmbed、Instagram = 埋め込み SSR。#1375 3 巡目）
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
import { StorageService } from '../../core/storage/storage.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { DishCategoryVariantDictionaryService } from './dish-category-variant-dictionary.service';
import {
  SnsOembedService,
  PLAYBACK_UNKNOWN,
  type EmbedPlaybackVerdict,
  type SnsMetadata,
} from './sns-oembed.service';

import { Prisma } from '../../../../shared/prisma/client';
import {
  parseSnsUrl,
  type SnsUrlContent,
  type SnsUrlParseResult,
} from '../../../../shared/utils/snsUrl';
import { matchDishCategoriesWithIndex } from '../../../../shared/utils/dishCategoryMatch';
import { matchRestaurantNames } from '../../../../shared/utils/restaurantNameMatch';
import {
  extractPinNames,
  type ExtractedText,
} from '../../../../shared/utils/textNormalize';
import {
  extractPostalAddress,
  parseGsiAddressSearchResponse,
  type GeocodedPoint,
} from './sns-address';
import type {
  CreateDishMediaImportDto,
  ResolveDishMediaImportDto,
} from '@shared/v1/dto';
import type {
  CreateDishMediaImportResponse,
  ReportExternalEmbedPlaybackResponse,
  ResolveDishMediaImportDishCategoryCandidate,
  ResolveDishMediaImportReason,
  ResolveDishMediaImportResponse,
  ResolveDishMediaImportRestaurantCandidate,
  ResolveDishMediaImportRestaurantSearchReason,
  ResolveDishMediaImportStatus,
} from '@shared/v1/res';

/**
 * 照合対象として引く近傍店舗の件数（1 エリアあたり）。
 *
 * `QueryRestaurantsDto.limit` の上限（100）に合わせてある。
 *
 * ⚠️ `matchRestaurantNames` は入力の**先頭 200 件で頭打ち**になる。エリアは最大 2 つ
 * （キャプション住所 + 現在地）で author 検索も足すと最大 240 件になり得るため、
 * **並べる順序が意味を持つ**（住所エリアを先頭にする。findRestaurantCandidates 参照）。
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

/**
 * キャプションの住所をジオコーディングした地点で照合する半径（m）。
 *
 * 国土地理院は地番レベル（実測で店舗座標と 30m 差）まで解決するが、
 * 住所の書き方の揺れ（「東町1-3」と「東町１番３号」）や店舗座標側のズレを
 * 吸収するため 1km 取る。ユーザー現在地の 5km と違い、住所は «店そのもの» を
 * 指しているので狭くてよい。
 */
const CAPTION_ADDRESS_RADIUS_M = 1_000;

/**
 * 外部サムネイルを取りにいってよい CDN ホスト（provider 別）。
 *
 * `thumbnail_url` は provider の応答由来だが、それでもサーバから外へ出る先は
 * 明示的な allowlist で縛る（SafeFetch `fetchImage` の `allowHost`）。
 */
const THUMBNAIL_CDN_ALLOWLIST: Record<string, (host: string) => boolean> = {
  instagram: (host) =>
    host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net'),
  tiktok: (host) =>
    host.endsWith('.tiktokcdn.com') || host.endsWith('.tiktokcdn-us.com'),
  youtube: (host) => host === 'i.ytimg.com' || host.endsWith('.ytimg.com'),
};

/**
 * 複製するサムネイルの上限サイズ。Instagram の実測は 100〜300 KiB で、
 * 5 MiB は 15 倍以上の余裕。これを超えるものはサムネイルではない
 */
const IMPORT_THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 国土地理院 ジオコーディング API（無料・キー不要・日本国内のみ）。
 *
 * Google Geocoding / Places は**課金になるので使わない**（オーナー方針）。
 * 固定エンドポイントなので SafeFetch の fetchJson（SSRF 検証なし・衛生あり）で叩く。
 */
const GSI_ADDRESS_SEARCH_BASE =
  'https://msearch.gsi.go.jp/address-search/AddressSearch';

/**
 * #1641 端末の «再生できなかった» 報告から、同じ投稿をもう一度確かめに行くまでの最短間隔。
 *
 * この経路は**ユーザーの端末が引き金になって provider を叩く**。間引きが無いと、
 * 電波の悪い 1 台がフィードを往復するだけで同じ投稿へ何十回も問い合わせが飛ぶ
 * （こちらが弾かれる側になる）。6 時間空けても «壊れた投稿がしばらく残る» だけで、
 * 実害は «そのセルが 1 回空振りする» に留まる。
 */
const PLAYBACK_RECHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * #1641 再生可否の判定を `dish_media_external_embeddings` の更新値へ写す。
 *
 * ## `playback_reason` は**必ず同じ data に入れる**
 *
 * `playback_reason` は «`not_playable` のときだけ非 NULL» という CHECK 制約
 * （`dmee_playback_reason_check`）で守られている。再取り込みで
 * `not_playable` → `playable` へ変わったときに status だけ書き換えると、
 * 古い理由が残ったまま制約に当たって**取り込みが 500 になる**。
 * だから «status を書くときは reason も書く» を、この 1 箇所へ閉じ込める。
 *
 * ## `unknown` は書かない
 *
 * 判定できなかったのだから、**既に分かっている判定を上書きしてはいけない**。
 * 空オブジェクトを返して、列を触らせない（新規行は列の DEFAULT 'unknown' になる）。
 */
function playbackUpdate(playback: EmbedPlaybackVerdict):
  | Record<string, never>
  | {
      playback_status: string;
      playback_reason: string | null;
      playback_checked_at: Date;
    } {
  if (playback.status === 'unknown') return {};
  return {
    playback_status: playback.status,
    playback_reason:
      playback.status === 'not_playable' ? playback.reason : null,
    playback_checked_at: new Date(),
  };
}

@Injectable()
export class DishMediaImportsService {
  constructor(
    private readonly safeFetch: SafeFetchService,
    private readonly oembed: SnsOembedService,
    private readonly dictionary: DishCategoryVariantDictionaryService,
    private readonly dishCategoriesRepo: DishCategoriesRepository,
    private readonly restaurantsRepo: RestaurantsRepository,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cloudTasks: CloudTasksService,
    private readonly logger: AppLoggerService,
    private readonly cls: ClsService,
  ) {}

  /**
   * #1641 端末から «このセルは再生できなかった» と報告を受けて、**サーバが確かめ直す**。
   *
   * ## 端末の言い分は保存しない
   *
   * 「再生できなかった」の原因は投稿の側とは限らない（機内モード・一時的な 5xx・
   * WebView が殺された直後・古いビルド）。鵜呑みにして書くと、**通信が不安定な
   * ユーザーが 1 人いるだけで、その投稿が全員の検索から消える**。
   * ここで受け取るのは «見に行くきっかけ» だけで、判定は取り込みのときと同じ経路
   * （`SnsOembedService.fetchMetadata` の `playback`）でやり直す。
   *
   * ## 直したいのは «取り込んだ後で壊れた» 投稿である
   *
   * 取り込み時は再生できたが、後から楽曲の権利ブロックが入る / 投稿者が埋め込みを
   * 切る、ということが起きる。定期バッチは持っていない（このリポジトリに死活監視の
   * cron は 1 本も無い）ので、**実際に踏んだ端末が引き金を引く**のがいちばん確実で、
   * かつ «誰も見ていない投稿を確かめ続ける» 無駄も出ない。
   *
   * ## 例外を投げない
   *
   * 埋め込みの行が無い（自撮りの投稿だった等）場合も 200 で返す。この呼び出しは
   * 画面の裏で自動的に飛ぶので、失敗をユーザーへ見せる意味が無い。
   */
  async reportUnplayable(
    dishMediaId: string,
  ): Promise<ReportExternalEmbedPlaybackResponse> {
    /* ⚠️ **provider への問い合わせをトランザクションの中に入れない。**
       `withTransaction` は接続を掴んだまま中身を走らせる。外部 HTTP（最悪 15 秒）を
       挟むと、その間コネクションプールの 1 本が塞がる。読みと書きを別のトランザクションに
       分け、間で問い合わせる。 */
    const row = await this.prisma.withTransaction((tx) =>
      tx.dish_media_external_embeddings.findFirst({
        where: { dish_media_id: dishMediaId },
        select: {
          canonical_url: true,
          playback_status: true,
          playback_reason: true,
          playback_checked_at: true,
        },
      }),
    );

    const current = (row: {
      playback_status: string;
      playback_reason: string | null;
    }): Omit<ReportExternalEmbedPlaybackResponse, 'rechecked'> => ({
      playbackStatus:
        row.playback_status as ReportExternalEmbedPlaybackResponse['playbackStatus'],
      playbackReason:
        (row.playback_reason as ReportExternalEmbedPlaybackResponse['playbackReason']) ??
        null,
    });

    if (row === null) {
      return {
        playbackStatus: 'unknown',
        playbackReason: null,
        rechecked: false,
      };
    }

    // 直近に確かめたばかりなら、もう一度 provider を叩かない
    const checkedAt = row.playback_checked_at?.getTime() ?? null;
    if (
      checkedAt !== null &&
      Date.now() - checkedAt < PLAYBACK_RECHECK_MIN_INTERVAL_MS
    ) {
      return { ...current(row), rechecked: false };
    }

    const parsed = parseSnsUrl(row.canonical_url);
    if (parsed === null || parsed.kind !== 'content') {
      // 保存した URL がいまの判定器では解釈できない。推測で書かない
      this.logger.warn('EmbedPlaybackRecheckUnparsable', 'reportUnplayable', {
        dishMediaId,
      });
      return { ...current(row), rechecked: false };
    }

    const outcome = await this.oembed.fetchMetadata(parsed);
    const playback = outcome.playback;

    /* ⚠️ **debug ではなく log（info）で残す。** ここは端末の報告を受けて **DB を書き換える**
       転換点で、後から «いつ・何が・何へ変わったか» を追えないと、
       «勝手に消えた投稿» を説明できなくなる。debug は dev のログ基盤に残らない
       （実測: BigQuery の backend_event_logs に 1 行も出なかった）。 */
    this.logger.log('EmbedPlaybackRechecked', 'reportUnplayable', {
      dishMediaId,
      provider: parsed.provider,
      before: row.playback_status,
      after: playback.status,
    });

    /* ⚠️ **判定できなかったときは status を書き換えない。** 端末が «駄目だった» と
       言っているからといって not_playable へ寄せると、provider が一時的に落ちた日に
       取り込み済みの投稿がまとめて検索から消える。
       ただし `playback_checked_at` は進める（間引きが効かないと、同じ端末が
       何度でも provider を叩ける経路になる）。 */
    const data =
      playback.status === 'unknown'
        ? { playback_checked_at: new Date() }
        : {
            playback_status: playback.status,
            // status と reason は必ず同じ UPDATE で書く（CHECK dmee_playback_reason_check）
            playback_reason:
              playback.status === 'not_playable' ? playback.reason : null,
            playback_checked_at: new Date(),
          };

    await this.prisma.withTransaction((tx) =>
      tx.dish_media_external_embeddings.updateMany({
        where: { dish_media_id: dishMediaId },
        data,
      }),
    );

    return {
      playbackStatus:
        playback.status === 'unknown'
          ? current(row).playbackStatus
          : playback.status,
      playbackReason:
        playback.status === 'not_playable' ? playback.reason : null,
      rechecked: true,
    };
  }

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
    const { response: resolved, playback } = await this.resolveInternal({
      url: dto.url,
    });

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

    // findFirst → create は非原子なので、同じ投稿を同時に取り込むと後発が
    // UNIQUE（dmee_provider_content_dish_uq）で P2002 になる（独立レビュー指摘 #4）。
    // その場合は 1 回だけやり直す — 2 回目は findFirst が先行の行を見つけて
    // 冪等経路（save だけ足す）を通るので、契約どおり成功で返せる
    try {
      return await this.runCreateTransaction(
        dto,
        userId,
        resolved,
        playback,
        appVersion,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn('SnsImportCreateRaceRetried', 'create', {
          provider,
          externalContentId,
        });
        return this.runCreateTransaction(
          dto,
          userId,
          resolved,
          playback,
          appVersion,
        );
      }
      throw error;
    }
  }

  /** `create()` の本体。P2002 リトライのために切り出してある */
  private async runCreateTransaction(
    dto: CreateDishMediaImportDto,
    userId: string,
    resolved: ResolveDishMediaImportResponse,
    playback: EmbedPlaybackVerdict,
    appVersion: string,
  ): Promise<CreateDishMediaImportResponse> {
    const { provider, externalContentId, canonicalUrl } = resolved.source;
    if (!provider || !externalContentId || !canonicalUrl) {
      throw new BadRequestException('IMPORT_UNSUPPORTED:unsupported_url');
    }

    return this.prisma
      .withTransaction(async (tx) => {
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

        /* 1.5 #1599 【バグ】以降の «無ければ作る» はすべて findFirst → create の
           TOCTOU である。同じ SNS 投稿を同じ料理へ同時に取り込むリクエストが
           2 本来ると、両方の findFirst が空振りして両方が create し、後発が
           `dmee_provider_content_dish_uq` で P2002 になって 500 になる。

           ⚠️ **catch して読み直す方式は取れない。** ここは `$transaction` 内で、
              Postgres では P2002 が出た時点でトランザクション全体が aborted に
              なるため、同じ tx での後続クエリはすべて失敗する。
              «そもそも同時に来ない» ようにするしかない。

           ⚠️ dish_media には自然キーの UNIQUE が無い（PK はランダム UUID）ので、
              dmee 側だけを ON CONFLICT DO NOTHING にする手も使えない。
              先に作った dish_media が «どこからも参照されない孤児» として
              残ってしまう。

           そこで自然キーで xact 単位の advisory lock を取り、この区間を直列化する。
           `pg_advisory_xact_lock` は commit / rollback のどちらでも自動解放される
           （明示的な unlock が不要で、途中で例外が出てもロックが残らない）。
           待つのはまったく同じ (provider, 投稿, 料理) を同時に取り込む相手だけで、
           tx 本体は短いので実質的な直列化コストは無い。 */
        const importLockKey = `dish_media_import:${provider}:${externalContentId}:${dish.id}`;
        /* ⚠️ `$queryRaw` ではなく `$executeRaw` を使うこと。

           `pg_advisory_xact_lock` の戻り値は `void` で、`$queryRaw` は結果セットの
           各列を Prisma の型へ復元しようとするため、**必ず**次で落ちる（#1629 / dev 実測）:

             PrismaClientKnownRequestError: Raw query failed. Code: `N/A`.
             Message: `Failed to deserialize column of type 'void'.`

           つまり «同時実行のとき» ではなく **取り込みが毎回 500 になる**。
           `::text` などへキャストして逃げることはできない（void からのキャストは無い）。
           `$executeRaw` は列を復元せず作用行数だけを返すので、void でも通る。 */
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${importLockKey})::bigint)`;

        /* 2. 同じ SNS 投稿が同じ料理へ既に取り込まれていないか */
        const existing = await tx.dish_media_external_embeddings.findFirst({
          where: {
            provider,
            external_content_id: externalContentId,
            dish_id: dish.id,
          },
          select: {
            dish_media_id: true,
            // #1513 論理削除された行も自然キーの UNIQUE
            // (`dmee_provider_content_dish_uq`) を占有し続ける。取り込み直しを
            // 成立させるには、既存行が削除済みかどうかをここで知る必要がある
            dish_media: { select: { deleted_at: true } },
          },
        });

        let dishMediaId = existing?.dish_media_id ?? null;
        const created = dishMediaId === null;

        // #1513 一度削除した SNS 投稿を同じ料理へ取り込み直したときは、既存行を復活させる。
        // 自然キーの UNIQUE があるので新しい dish_media を作ることはできず、ここで
        // `deleted_at` を戻さないと «取り込みは成功したのにどこにも出ない» 状態になる。
        // 復活させてよいのは、この行が特定のユーザーの持ち物ではない（`user_id` は常に
        // NULL で、ユーザーとの紐付けは下の reactions(save) だけ）ためである。
        if (dishMediaId !== null && existing?.dish_media.deleted_at) {
          await tx.dish_media.update({
            where: { id: dishMediaId },
            data: { deleted_at: null, updated_at: new Date() },
          });
        }

        if (dishMediaId !== null) {
          const data = {
            // #1375（3 巡目）再取り込み時はサムネイル URL を更新する。Instagram / TikTok の
            // CDN URL は署名付きで数日〜数週間で失効するため、取れたときに貼り替えておく
            ...(resolved.status === 'ok'
              ? {
                  thumbnail_url: resolved.metadata.thumbnailUrl,
                  embed_status: 'available' as const,
                  last_verified_at: new Date(),
                }
              : {}),
            /* #1641 再生可否も貼り替える。**メタデータ取得の成否とは別の条件で書く。**
               YouTube の «埋め込み不可» は oEmbed 401（= resolved.status は 'unknown'）
               として現れるので、`status === 'ok'` の中に入れると
               **一番書きたいケースだけ書けない**。 */
            ...playbackUpdate(playback),
          };
          if (Object.keys(data).length > 0) {
            await tx.dish_media_external_embeddings.updateMany({
              where: {
                provider,
                external_content_id: externalContentId,
                dish_id: dish.id,
              },
              data,
            });
          }
        }

        if (dishMediaId === null) {
          /* 3. dish_media。実体は自ストレージに無いので media_path は NULL */
          const media = await tx.dish_media.create({
            data: {
              dish_id: dish.id,
              // 投稿者はアプリのユーザーではない（上のコメント参照）
              user_id: null,
              media_path: null,
              media_type: 'image',
              // NOT NULL なので空文字を入れる。この直後に replicateExternalThumbnail が
              // 自ストレージへ複製して据え替える（オーナー承認 2026-08-23）。複製が失敗して
              // いる間は dish_media_external_embeddings.thumbnail_url →
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
              // 外部サムネイル URL は provenance と複製失敗時のフォールバックとして残す。
              // 表示の一次ソースはこの後の複製（replicateExternalThumbnail）が置く
              // dish_media.thumbnail_path（オーナー承認 2026-08-23: 自ストレージへ複製する）
              thumbnail_url: resolved.metadata.thumbnailUrl,
              // #1641 判定できていなければ列の DEFAULT（'unknown'）のままになる
              ...playbackUpdate(playback),
            },
          });
        }

        /* 5. 「食べたい」= reactions(save)。ここがユーザーとの唯一の紐付けである */
        // #1599 ここも findUnique → create の TOCTOU だった。上の advisory lock は
        // 取り込み経路どうしの競合しか直列化しないので、別経路（通常の save）と
        // 同時に走ると `reactions` の複合 UNIQUE
        // (user_id, target_type, target_id, action_type) で P2002 になりうる。
        //
        // `createMany({ skipDuplicates: true })` = INSERT ... ON CONFLICT DO NOTHING
        // なら競合しても例外にならず、返ってくる count がそのまま
        // «今回このユーザーのために新しく保存したか» になる（1 = 新規 / 0 = 既存）。
        // findUnique + create の 2 クエリが 1 クエリに減る副産物もある。
        const savedNow = await tx.reactions.createMany({
          data: [
            {
              user_id: userId,
              target_type: 'dish_media',
              target_id: dishMediaId,
              action_type: 'save',
              created_at: new Date(),
              created_version: appVersion,
              lock_no: 0,
            },
          ],
          skipDuplicates: true,
        });

        return {
          dishMediaId,
          dishId: dish.id,
          created,
          saved: savedNow.count === 1,
        };
      })
      .then(async (result) => {
        // #1375 4 巡目（オーナー承認 2026-08-23）: 外部サムネイルは失効する
        // （Instagram scontent は実測 4〜5 日）ので、自ストレージへ複製して恒久化する。
        // 失敗しても取り込み自体は成立している（外部 URL フォールバックが効く）ので
        // create は失敗にしない
        if (
          resolved.status === 'ok' &&
          resolved.metadata.thumbnailUrl !== null
        ) {
          await this.replicateExternalThumbnail(
            result.dishMediaId,
            provider,
            resolved.metadata.thumbnailUrl,
          );
        }
        return result;
      });
  }

  /**
   * 外部 CDN のサムネイルを自ストレージ（GCS）へ複製し、`dish_media.thumbnail_path` に
   * 据える。以後の表示は通常投稿と同じ経路（リサイズ済み CDN）になり、外部 URL の
   * 失効に影響されない。
   *
   * - 既に `thumbnail_path` が入っていれば何もしない（再取り込みのたびに転送しない）
   * - 取得先ホストは provider 別 allowlist で縛る（`fetchImage` の `allowHost`）
   * - どこで失敗しても throw せず縮退（外部 URL フォールバックが残っている）
   */
  private async replicateExternalThumbnail(
    dishMediaId: string,
    provider: string,
    thumbnailUrl: string,
  ): Promise<void> {
    const allowHost = THUMBNAIL_CDN_ALLOWLIST[provider];
    if (!allowHost) return;

    try {
      const current = await this.prisma.withTransaction((tx) =>
        tx.dish_media.findUnique({
          where: { id: dishMediaId },
          select: { thumbnail_path: true },
        }),
      );
      if (!current || current.thumbnail_path !== '') return;

      const { buffer, contentType } = await this.safeFetch.fetchImage(
        thumbnailUrl,
        {
          apiName: `${provider} thumbnail`,
          functionName: 'replicateExternalThumbnail',
          allowHost,
          maxResponseBytes: IMPORT_THUMBNAIL_MAX_BYTES,
        },
      );

      // `image/jpeg; charset=...` のようなパラメータを落とし、既知の画像型だけ通す
      const mimeType = contentType.split(';')[0].trim();
      if (
        mimeType !== 'image/jpeg' &&
        mimeType !== 'image/png' &&
        mimeType !== 'image/webp'
      ) {
        this.logger.warn(
          'ImportThumbnailUnsupportedType',
          'replicateExternalThumbnail',
          { dishMediaId, provider, contentType },
        );
        return;
      }

      const uploaded = await this.storage.uploadFile({
        buffer,
        mimeType,
        resourceType: 'dish_media',
        usageType: 'imported-thumbnail',
        identifier: dishMediaId,
      });

      // 事前確認と update の間には外部 fetch + upload が挟まる（TOCTOU）。同じ投稿の
      // 同時取り込みで両方がここへ来ても、`thumbnail_path: ''` を条件に入れた
      // updateMany なら勝つのは 1 本だけで、負けた側は 0 件更新で静かに終わる
      const updated = await this.prisma.withTransaction((tx) =>
        tx.dish_media.updateMany({
          where: { id: dishMediaId, thumbnail_path: '' },
          data: {
            thumbnail_path: uploaded.path,
            // 通常投稿と同じく、リサイズ完了までは original が配信される（assembler の規則）
            thumbnail_processing_status: 'processing',
          },
        }),
      );
      if (updated.count === 0) return;

      await this.cloudTasks.enqueueResizeImage({
        table: 'dish_media',
        column: 'thumbnail_path',
        recordId: dishMediaId,
        size: 256,
        aspectRatio: 9 / 16,
        originalPath: uploaded.path,
      });

      this.logger.log(
        'ImportThumbnailReplicated',
        'replicateExternalThumbnail',
        {
          dishMediaId,
          provider,
          path: uploaded.path,
          bytes: buffer.length,
        },
      );
    } catch (error) {
      this.logger.warn(
        'ImportThumbnailReplicateFailed',
        'replicateExternalThumbnail',
        {
          dishMediaId,
          provider,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async resolve(
    dto: ResolveDishMediaImportDto,
  ): Promise<ResolveDishMediaImportResponse> {
    return (await this.resolveInternal(dto)).response;
  }

  /**
   * #1641 `resolve()` の本体。**再生可否の判定を一緒に返す。**
   *
   * ## なぜ公開レスポンスへ載せないのか
   *
   * `playback` は «その投稿を検索フィードへ出すか / WebView をマウントするか» という
   * **保存側の都合**であって、確認画面がユーザーへ見せる情報ではない。公開レスポンスへ
   * 足すと、クライアントがそれを見て独自に分岐しはじめ、判定の正が 2 箇所になる。
   * 保存に要るものだけを内部で受け渡す。
   *
   * ## 追加のリクエストはゼロである
   *
   * 判定材料は**キャプション取得のために既に引いた応答**（Instagram の埋め込み SSR /
   * YouTube の oEmbed のステータス）だけで、ここから外部へ増える通信は無い。
   */
  private async resolveInternal(dto: ResolveDishMediaImportDto): Promise<{
    response: ResolveDishMediaImportResponse;
    playback: EmbedPlaybackVerdict;
  }> {
    const limit = dto.limit ?? DEFAULT_CANDIDATE_LIMIT;
    // メタデータを取る前に失敗した経路は «判定できなかった»。弾かない側の既定値で返す
    let playback: EmbedPlaybackVerdict = PLAYBACK_UNKNOWN;

    /* 1. URL の解釈。判定ロジックはここに書かない（`shared/utils/snsUrl.ts` が正本） */
    const parsed = parseSnsUrl(dto.url);
    if (parsed === null) {
      this.logger.debug('SnsImportUnsupportedUrl', 'resolve', {
        length: dto.url.length,
      });
      return {
        response: this.emptyResponse(
          'unsupported',
          'unsupported_url',
          null,
          false,
          dto,
        ),
        playback,
      };
    }

    /* 2. 短縮 URL なら展開して、もう一度同じ判定に通す */
    let content: SnsUrlContent;
    let expandedFromShortlink = false;

    if (parsed.kind === 'shortlink') {
      const expanded = await this.expandShortlink(parsed);
      if (expanded.content === null) {
        return {
          response: this.emptyResponse(
            'unsupported',
            expanded.reason,
            null,
            true,
            dto,
          ),
          playback,
        };
      }
      content = expanded.content;
      expandedFromShortlink = true;
    } else {
      content = parsed;
    }

    /* 3. メタデータ。
       #1273 大量並列 resolve: **収集時のキャプションが渡されていれば IG を取りに行かない。**
       投稿ごとに `instagram.com/p/{code}/embed/captioned/` を叩くのがレート制限の元凶で、
       これが並列も長時間連続も頭打ちにしていた（実測: 並列 fetch失敗73% / 単発長時間も劣化）。
       収集側（business_discovery のキャプション・CC/検索の記事本文）で既にテキストは
       得られているので、それを持ち回って渡せば店照合/カテゴリ判定は純粋なテキスト処理になり、
       IG を一切叩かず好きなだけ並列できる。渡されないときは従来どおり provider 公式経路で取る。 */
    let metadata: SnsMetadata;
    const providedCaption =
      typeof dto.caption === 'string' && dto.caption.trim() !== ''
        ? dto.caption
        : null;
    if (providedCaption !== null) {
      metadata = {
        title: providedCaption,
        description: null,
        authorName:
          typeof dto.authorName === 'string' && dto.authorName.trim() !== ''
            ? dto.authorName
            : null,
        authorUrl: null,
        thumbnailUrl: null,
      };
      // playback は既定の PLAYBACK_UNKNOWN のまま（埋め込み可否は判定していない）。
    } else {
      const outcome = await this.oembed.fetchMetadata(content);
      /* #1641 メタデータが取れたかどうかとは独立に、再生可否は確定していることがある
         （YouTube の «埋め込み不可» は oEmbed 401 = メタデータ失敗として現れる）。
         だから status の分岐より**先に**引き取る。 */
      playback = outcome.playback;

      if (outcome.status === 'unavailable') {
        return {
          response: this.emptyResponse(
            'unavailable',
            'metadata_content_unavailable',
            content,
            expandedFromShortlink,
            dto,
          ),
          playback,
        };
      }
      if (outcome.status === 'unknown') {
        // Instagram（取得手段が無い）も、oEmbed の 5xx / タイムアウトもここへ来る。
        // **どちらも「取り込みは続行してよい」状態**なので、埋め込みに要る情報は返し切る。
        return {
          response: this.emptyResponse(
            'unknown',
            outcome.kind === 'provider_unsupported'
              ? 'metadata_provider_unsupported'
              : 'metadata_fetch_failed',
            content,
            expandedFromShortlink,
            dto,
          ),
          playback,
        };
      }

      /*
      #1641 **YouTube は Shorts だけを取り込む**（#1399 リーダー確定 §1）。

      `/watch?v=` と `youtu.be/` は URL だけでは Shorts か判定できないので
      `requiresShortsCheck` が立つ。**その確定処理がどこにも無く、横長の通常動画が
      そのまま取り込めていた**（オーナー指摘 2026-08-28。セルでは上下に黒帯が出る）。

      ⚠️ 判定できなかったときは**弾かずに通す**（同 §3 の条件 1）。判定材料は YouTube の
         実装であって契約された仕様ではないので、安全側に倒すと向こうが挙動を変えた日に
         取り込みが全部止まる。`requiresShortsCheck` を立てたまま返し、呼び出し側に委ねる。
      */
      if (
        content.provider === 'youtube' &&
        content.requiresShortsCheck === true
      ) {
        const verdict = await this.oembed.confirmYouTubeShorts(
          content.externalContentId,
        );
        if (verdict === 'not_shorts') {
          this.logger.debug('SnsImportYouTubeNotShorts', 'resolve', {
            externalContentId: content.externalContentId,
          });
          return {
            response: this.emptyResponse(
              'unsupported',
              'youtube_not_shorts',
              content,
              expandedFromShortlink,
              dto,
            ),
            playback,
          };
        }
        // Shorts だと確定したなら、呼び出し側へ «要確認» を持ち越さない
        if (verdict === 'shorts')
          content = { ...content, requiresShortsCheck: false };
      }

      metadata = outcome.metadata;
    }
    const texts = this.buildExtractedTexts(content, metadata);

    /* 4-5. 料理カテゴリ候補と店舗候補。互いの結果を使わないので並列に走らせる
       （店舗側はジオコーディング HTTP + DB 検索を持ち、直列だと応答時間が合算になる） */
    const [dishCategoryOutcome, restaurantOutcome] = await Promise.all([
      texts.length === 0
        ? Promise.resolve({
            candidates: [] as ResolveDishMediaImportDishCategoryCandidate[],
            prefillDishCategoryId: null as string | null,
          })
        : this.findDishCategoryCandidates(texts, limit),
      this.findRestaurantCandidates(dto, texts, metadata.authorName, limit),
    ]);

    const reason: ResolveDishMediaImportReason =
      texts.length === 0 && metadata.authorName === null
        ? 'metadata_empty'
        : 'resolved';

    return {
      playback,
      response: {
        status: 'ok',
        reason,
        source: this.buildSource(content, expandedFromShortlink),
        metadata: {
          title: metadata.title,
          // #1629 説明文も返す。内部の候補抽出には使っていたのに返しておらず、
          // 確認画面では «キャプションが取れていない» ように見えていた（型側のコメント参照）
          description: metadata.description ?? null,
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
    /*
    #1641 **TikTok は公式 oEmbed で先に解決する。**

    自分で `vt.tiktok.com` へアクセスして 301 を追う方式は、**Cloud Run からは
    接続そのものが成立しない**（dev 実ログ: `kind: "network_error"` /
    外部 API ログ `status_code=0`）。同じ URL は開発環境の curl では 301 を返すので、
    TikTok 側がこのサーバの出口を弾いていると見られ、こちらからは直せない。

    oEmbed は短縮 URL をそのまま受けて動画 ID とキャプションを返し、
    その `www.tiktok.com` へは到達できている（フル URL の取り込みは成功している）。
    詳細は `SnsOembedService.resolveTikTokShortlink` のコメント。

    ⚠️ oEmbed が失敗したら**従来のリダイレクト追跡へ落ちる**。TikTok が oEmbed を
    閉じたときに «短縮 URL が一切使えない» へ戻らないよう、経路は 2 本残す。
    */
    if (shortlink.provider === 'tiktok') {
      const viaOembed = await this.oembed.resolveTikTokShortlink(
        shortlink.expandUrl,
      );
      if (viaOembed !== null) {
        return { content: viaOembed, reason: 'resolved' };
      }
    }

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
    const texts: ExtractedText[] = [];

    // TikTok / Instagram の `title` はキャプション本文（ハッシュタグ・店舗情報込み）、
    // YouTube の `title` は動画題名。由来が違うので field を分けておく
    // （信頼度の調整はしていないが、根拠のログで区別できる）。
    // Instagram は #1375（3 巡目）で埋め込み SSR からキャプションが取れるようになった
    const field: ExtractedText['field'] =
      content.provider === 'youtube' ? 'title' : 'caption';
    if (metadata.title !== null) texts.push({ field, text: metadata.title });

    /*
    #1641 **YouTube は説明文も渡す。** オーナー報告「キャプションが取れてないので店が入らない」。

    YouTube の題名には店舗情報が無く、店名・住所は**説明文**に書かれている（実測 `8KJDwppL0qg`）。
    題名だけを渡していたため候補がゼロになり、毎回お店を手で選ぶ必要があった。
    説明文はキャプション相当なので `caption` として渡す。
    */
    if (metadata.description) {
      texts.push({ field: 'caption', text: metadata.description });
    }

    return texts;
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
   * 店舗候補を出す。探す «地点» は 2 系統ある。
   *
   *  1. **ユーザーの現在地**（呼び出し側が lat/lng/radius を渡す。設計 骨子 Q-3）
   *  2. **キャプションに書かれた住所**（#1375 4 巡目）… 「📍 住所：東京都八王子市…」の
   *     形で店の住所が書かれていることが多く、現在地が店から離れていても（家で取り込む
   *     のが普通の使い方）ここから店へ辿れる。国土地理院の無料 API で座標化する
   *
   * どちらも無ければ候補は空で返す。**これは失敗ではなく既定の状態**であり、
   * 呼び出し側は「見つかりませんでした」ではなく「地図から店を選んでください」を出すこと（設計 §5-3）。
   *
   * 各地点での引き方は 2 本立て。
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
    if (provided > 0 && provided < 3) {
      // 一部だけ渡すのは呼び出し側の組み立てミス。400 にはせず、区別できる理由で返す。
      // ただしキャプション住所からは引けるかもしれないので、ここでは打ち切らない
      this.logger.warn('SnsImportAreaIncomplete', 'findRestaurantCandidates', {
        provided,
      });
    }

    const searchAreas: {
      lat: number;
      lng: number;
      radius: number;
      orderByDistance?: boolean;
    }[] = [];
    if (provided === 3) {
      /*
        #1834 【性能】**現在地エリアも «距離順» で引く。既定の «投稿が多い順» を使わない。**

        ## 何が起きていたか

        オーナー報告「SNS インポートの読み込みがめっちゃ遅い」。本番ログを request_id で
        時系列に並べると、1 リクエストの中で内訳がはっきり分かれていた（2026-09-04 実測）:

          Instagram 埋め込み取得            1,396 ms
          住所ジオコーディング                 91 ms
          住所エリアの店舗検索（距離順）        332 ms / 138 ms
          **現在地エリアの店舗検索（既定順）  26,672 ms**  ← ここだけで 9 割
          現在地エリアの店舗検索（author 付き） 450 ms

        3 リクエストとも同じ形で、26.7 / 29.2 / 26.4 秒。**クライアントの上限は 30 秒**
        なので、体感は «30 秒待たされる» か «待った末に読み取り失敗» のどちらかになる
        （実際に `api_call_timeout` が出ており、直後にユーザーが押し直した再取得が
        Instagram のレート制限（302）に当たって «読み取れませんでした» になっていた。
        つまり «遅い» と «読み取れないことが多い» は同じ 1 本の原因から出ている）。

        ## なぜ既定順だと重いのか

        既定順（`orderByDistance` なし）は «投稿が多い順» の枠を組む経路で、
        `post_counts`（dish_media 全行の集計）と、投稿を持つ店 1 件ずつの
        LATERAL 探索が走る。この経路の計測ラチェット
        （`measure_order_by_posts.py` / `restaurants.order-by-posts-plan.spec.ts`）は
        **limit 20 でしか測っていない**が、ここは limit 100 で呼んでいる。
        LIMIT は literal で埋まる（`restaurants.repository.ts` の設計コメント参照）ので
        **limit 100 は別の prepared statement・別のプラン**であり、一度も測られていない。

        ## なぜ距離順が正しいのか（速いからではない）

        ここで集めた候補は `matchRestaurantNames` が**キャプションとの文字列一致**で
        並べ替える。投稿数の多寡は一致の強さと何の関係も無いので、«投稿が多い順» で
        上位 100 件を選ぶと、繁華街では «投稿が多いだけの無関係な店» で枠が埋まり
        **本命の個人店が候補に入らない**。住所エリア側を距離順にしたのと同じ理由
        （すぐ下のコメント）が、現在地エリアにもそのまま当てはまる。
        距離順は KNN 索引から «近い順に limit 件» を直接取るので、走る行数は半径にも
        投稿数にも依存しない。
      */
      searchAreas.push({
        lat: dto.lat as number,
        lng: dto.lng as number,
        radius: dto.radius as number,
        orderByDistance: true,
      });
    }

    if (texts.length === 0 && authorName === null) {
      // 照合するテキストが無ければ、どの地点で引いても当たらない（住所抽出も不可能）
      return empty(
        provided === 3
          ? 'no_extracted_text'
          : provided > 0
            ? 'area_incomplete'
            : 'area_not_provided',
      );
    }

    // キャプションに住所が書かれていれば、その地点の周辺でも探す（#1375 4 巡目）。
    //
    // ⚠️ **住所エリアを先頭に置く**（独立レビュー指摘 #2）。`matchRestaurantNames` は
    // 入力の先頭 200 件しか走査しないため、現在地エリアを先にすると（都心では
    // 100 + author 20 で埋まる）住所エリア側が切り落とされる。住所は «店そのもの» を
    // 指しており現在地より根拠が強いので、優先されるべきはこちらである。
    // 同じ理由で住所エリアの引きは入札額順ではなく **距離順**にする（指摘 #3。
    // 半径 1km に 100 件以上ある繁華街で、入札額 0 の個人店が落ちるのを防ぐ）
    const captionAddress = extractPostalAddress(texts);
    if (captionAddress !== null) {
      const geocoded = await this.geocodeCaptionAddress(captionAddress);
      if (geocoded !== null) {
        searchAreas.unshift({
          lat: geocoded.lat,
          lng: geocoded.lng,
          radius: CAPTION_ADDRESS_RADIUS_M,
          orderByDistance: true,
        });
      }
    }

    if (searchAreas.length === 0) {
      return empty(provided > 0 ? 'area_incomplete' : 'area_not_provided');
    }

    const rows = await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        const authorQuery = this.buildAuthorNameQuery(authorName);
        const collected: Awaited<
          ReturnType<RestaurantsRepository['searchNearbyRestaurants']>
        > = [];

        for (const areaParams of searchAreas) {
          collected.push(
            ...(await this.restaurantsRepo.searchNearbyRestaurants(tx, {
              ...areaParams,
              limit: AREA_RESTAURANT_LIMIT,
            })),
          );
          if (authorQuery !== null) {
            collected.push(
              ...(await this.restaurantsRepo.searchNearbyRestaurants(tx, {
                ...areaParams,
                q: authorQuery,
                limit: AUTHOR_NAME_RESTAURANT_LIMIT,
              })),
            );
          }
        }
        return collected;
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

    // #1273 生キャプション（改行を保った状態）から 📍<店名> 行を切り出し、exact-match の
    // ヒントとして渡す。含有一致 0.85 止まりで prefill（0.90）に届かなかった «店名を丸ごと
    // 📍 行に書く» 投稿を、無人取り込みの土俵へ乗せる。
    // ⚠️ texts の text は正規化前の生キャプション（buildExtractedTexts が metadata.title /
    //    description をそのまま入れる）なので、ここで改行連結してよい。normalize 済みを渡すと
    //    改行が潰れて 📍 行の切り出しが効かなくなる。
    // TODO(#1273 バケット2): 裸ハンドル（extractBareHandles）→ 店 ID 辞書での解決は、辞書が
    //    入ったら別 Issue でここへ繋ぐ。現状は辞書が無いので抽出のみ用意して未使用。
    const nameHints = extractPinNames(
      texts.map((text) => text.text).join('\n'),
    );

    const matched = matchRestaurantNames(
      { texts, candidates: searchCandidates, authorName, nameHints },
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

  /**
   * キャプションから抜いた住所を国土地理院 API で座標化する。失敗は `null` で縮退。
   *
   * ここが落ちても resolve 全体は失敗にしない（住所からの照合は «増やす» ための
   * 経路であって、従来の現在地照合を壊してよい理由にはならない）。
   */
  private async geocodeCaptionAddress(
    address: string,
  ): Promise<GeocodedPoint | null> {
    try {
      const body = await this.safeFetch.fetchJson(
        `${GSI_ADDRESS_SEARCH_BASE}?q=${encodeURIComponent(address)}`,
        {
          apiName: 'GSI AddressSearch',
          functionName: 'geocodeCaptionAddress',
        },
      );
      const point = parseGsiAddressSearchResponse(body);
      // ⚠️ 住所の生文字列はログへ入れない（独立レビュー指摘）。キャプション由来とはいえ
      // 個人の住所がパターンに一致することはあり得るし、ログは BigQuery へ永続化される。
      // SafeFetch がクエリ文字列を落とすのと同じ規律（safe-fetch.service.ts）に合わせる
      this.logger.debug('SnsImportAddressGeocoded', 'geocodeCaptionAddress', {
        addressLength: address.length,
        found: point !== null,
      });
      return point;
    } catch (error) {
      this.logger.warn(
        'SnsImportAddressGeocodeFailed',
        'geocodeCaptionAddress',
        {
          addressLength: address.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
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
        description: null,
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
