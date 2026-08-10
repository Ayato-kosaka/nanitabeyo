// api/src/modules/dish-media/dish-media.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ “副作用” は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  CreateDishMediaDto,
  CreateDishMediaViewDto,
  DishMediaImpressionBodyDto,
  ReactionActionType,
  SearchDishMediaDto,
} from '@shared/v1/dto';

import { DishMediaRepository } from './dish-media.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { env } from '../../core/config/env';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import {
  buildTranscodedPath,
  isValidUserUploadedPath,
} from 'src/core/storage/storage.utils';
import { DishMediaAssembler } from './dish-media.assembler';
import { DishMediaEntry } from '@shared/v1/res';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_APP_LANGUAGE } from '../../core/cls/cls.constants';
import { normalizePreferredLanguageCodes } from '../../../../shared/utils/languageCode';

@Injectable()
export class DishMediaService {
  constructor(
    private readonly repo: DishMediaRepository,
    private readonly assembler: DishMediaAssembler,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly transcoder: TranscoderService,
    private readonly cloudTasks: CloudTasksService,
    private readonly cls: ClsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/dish-media/search                      */
  /* ------------------------------------------------------------------ */
  async findByCriteria(dto: SearchDishMediaDto, userId: string) {
    this.logger.debug('FindByCriteria', 'findByCriteria', {
      location: dto.location,
      radius: dto.radius,
      categoryId: dto.categoryId,
      preferredLanguageCodes: dto.preferredLanguageCodes,
      userId,
    });

    const dishMediaIds = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.findDishMediaIds(tx, dto, userId),
    );

    const result = await this.fetchDishMediaEntryItems(dishMediaIds, {
      userId,
      preferredLanguageCodes: dto.preferredLanguageCodes,
    });

    this.logger.debug('FindByCriteriaResult', 'findByCriteria', {
      count: result.items.length,
    });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/dish-media?ids=...                      */
  /* ------------------------------------------------------------------ */
  async findByIds(ids: string[], viewerId: string) {
    this.logger.debug('FindByIds', 'findByIds', {
      count: ids.length,
      viewer: viewerId ?? 'anon',
    });

    const result = await this.fetchDishMediaEntryItems(ids, {
      userId: viewerId,
    });

    const foundSet = new Set(result.items.map((item) => item.dish_media.id));
    const notFound = ids.filter((id) => !foundSet.has(id));

    this.logger.debug('FindByIdsResult', 'findByIds', {
      count: result.items.length,
      notFound: notFound.length,
    });

    return {
      items: result.items,
      notFound,
    };
  }

  /**
   * dishMediaIds から DishMediaEntryItem[] を取得し、
   * 署名付き URL, CDN URL郡 を付与
   */
  public async fetchDishMediaEntryItems(
    dishMediaIds: string[],
    option: {
      userId: string;
      reviewLimit?: number;
      preferredLanguageCodes?: readonly string[];
    },
  ): Promise<{ items: DishMediaEntry[] }> {
    if (!dishMediaIds.length) return { items: [] };

    // #1052 【設計】呼び出し元が明示しない場合は端末言語（x-app-language）で補う。
    // これを入れないと search 以外の 5 経路（?ids= / 店舗詳細 / 投稿・いいね・保存タブ /
    // 通知）が created_at 順のままになり、「検索では日本語なのに店舗ページでは英語」
    // という #817 より混乱しやすい状態が残る。
    // 明示指定を優先するのは、検索が「端末言語 → 検索地点言語」の 2 段を渡すため。
    const preferredLanguageCodes =
      option.preferredLanguageCodes ?? this.resolveViewerLanguageCodes();

    const dishMediaEntries = await this.repo.getDishMediaEntriesByIds(
      dishMediaIds,
      { ...option, preferredLanguageCodes },
    );

    return this.assembler.toDishMediaEntry(dishMediaEntries);
  }

  /**
   * #1052 端末言語（x-app-language）を優先言語 1 段として返す。
   *
   * ヘッダ未送信の旧クライアントでは空配列になり、呼び出し側は
   * 「優先指定なし」＝従来の created_at 順へフォールバックする。
   */
  private resolveViewerLanguageCodes(): readonly string[] {
    const appLanguage = this.cls.get<string>(CLS_KEY_APP_LANGUAGE);
    return normalizePreferredLanguageCodes([appLanguage]);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-media (投稿)                     */
  /* ------------------------------------------------------------------ */
  async createDishMedia(dto: CreateDishMediaDto, creatorId: string) {
    this.logger.debug('CreateDishMedia', 'createDishMedia', {
      dishId: dto.dishId,
      userId: creatorId,
      mediaType: dto.mediaType,
    });

    // dishId が存在するか簡易バリデーション
    const dishExists = await this.repo.dishExists(dto.dishId);
    if (!dishExists) {
      this.logger.warn('DishNotFound', 'createDishMedia', {
        dishId: dto.dishId,
      });
      throw new NotFoundException('Dish not found');
    }

    // #セキュリティ 【検証】ユーザーアップロード領域に限る
    if (!isValidUserUploadedPath(dto.mediaPath, creatorId))
      throw new NotFoundException('Invalid mediaPath');

    // トランザクションで dish_media + 付随レコード作成
    const result = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.createDishMedia(tx, dto, {
          user_id: creatorId,
          thumbnail_path: dto.thumbnailPath,
          media_processing_status: 'processing',
          thumbnail_processing_status: 'processing',
        }),
    );

    this.logger.log('DishMediaCreated', 'createDishMedia', {
      mediaId: result.id,
      dishId: dto.dishId,
      mediaType: dto.mediaType,
    });

    if (dto.mediaType === 'video') {
      // video の場合、トランスコードジョブを直接作成
      const inputUri = `gs://${env.GCS_BUCKET_NAME}/${dto.mediaPath}`;
      const outputUri = `gs://${env.GCS_BUCKET_NAME}/${buildTranscodedPath({
        table: 'dish_media',
        column: 'media_path',
        recordId: result.id,
        originalPath: dto.mediaPath,
      }).replace(/\/master\.m3u8$/, '/')}`; // ディレクトリパスにするため末尾の master.m3u8 を削除

      await this.transcoder.createTranscodeJob({
        inputUri,
        outputUri,
        labels: {
          table_name: 'dish_media',
          column_name: 'media_path',
          record_id: result.id,
        },
      });

      this.logger.log('TranscodeJobCreated', 'createDishMedia', {
        mediaId: result.id,
        inputUri: dto.mediaPath,
        outputUri,
      });
    } else {
      // 画像のリサイズと保存を実行（投稿メディアのフルスクリーン表示用）
      await this.cloudTasks.enqueueResizeImage({
        table: 'dish_media',
        column: 'media_path',
        recordId: result.id,
        size: 1024,
        aspectRatio: 9 / 16,
        originalPath: dto.mediaPath,
      });
    }

    // 画像のリサイズと保存を実行（サムネイル用）
    await this.cloudTasks.enqueueResizeImage({
      table: 'dish_media',
      column: 'thumbnail_path',
      recordId: result.id,
      size: 256,
      aspectRatio: 9 / 16,
      originalPath: dto.thumbnailPath,
    });

    return convertPrismaToSupabase_DishMedia(result);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dish-media/view                       */
  /* ------------------------------------------------------------------ */
  async createDishMediaView(
    dish_media_id: string,
    dto: CreateDishMediaViewDto,
    user_id: string,
  ) {
    // Validation: cannot be both completed and skipped
    if (dto.is_completed && dto.is_skipped) {
      throw new Error('View cannot be both completed and skipped');
    }

    try {
      const result = await this.prisma.withTransaction(
        (tx: Prisma.TransactionClient) =>
          this.repo.createDishMediaView(tx, {
            impression_id: dto.impression_id,
            dish_media_id,
            user_id,
            started_at: dto.started_at,
            watch_ms: dto.watch_ms,
            is_completed: dto.is_completed,
            is_skipped: dto.is_skipped,
            rewatch_count: dto.rewatch_count,
          }),
      );

      return {
        id: result.id,
        dish_media_id: result.dish_media_id,
        impression_id: result.impression_id,
        stored: true,
        analysis_applied: true,
      };
    } catch (error) {
      const violation = this.resolveDishMediaTimingForeignKeyViolation(error);
      if (!violation) throw error;

      // #1222 view は #1223 の impression に連鎖して落ちる。impression が
      // FK 違反で作られなかった以上、そこを参照する view の impression_id も存在しない。
      this.logger.warn(
        'DishMediaViewForeignKeyViolation',
        'createDishMediaView',
        {
          dishMediaId: dish_media_id,
          impressionId: dto.impression_id,
          userId: user_id,
          fieldName: violation.fieldName,
        },
      );
      return {
        id: null,
        dish_media_id,
        impression_id: dto.impression_id,
        stored: false,
        analysis_applied: false,
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/reaction                      */
  /* ------------------------------------------------------------------ */
  async addReaction(
    dishMediaId: string,
    actionType: ReactionActionType,
    userId: string,
    isAnonymous: boolean,
  ) {
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.toggleReaction(tx, true, isAnonymous, {
        target_id: dishMediaId,
        action_type: actionType,
        user_id: userId,
      }),
    );

    // #通知機能 【設計】like/save 成功時に Cloud Tasks にジョブ投入（匿名ユーザーは除外）
    if (!isAnonymous && (actionType === 'like' || actionType === 'save')) {
      const idempotencyKey = `dish_media:${actionType}:${dishMediaId}`;
      this.cloudTasks
        .enqueueNotification({
          actionType,
          targetTable: 'dish_media',
          targetId: dishMediaId,
          actorId: userId,
          idempotencyKey,
        })
        .catch((error) => {
          this.logger.error('EnqueueNotificationFailed', 'addReaction', {
            dishMediaId,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      this.logger.debug('NotificationJobEnqueued', 'addReaction', {
        actionType,
        dishMediaId,
        userId,
        idempotencyKey,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*              DELETE /v1/dish-media/:id/reaction                    */
  /* ------------------------------------------------------------------ */
  async removeReaction(
    dishMediaId: string,
    actionType: ReactionActionType,
    userId: string,
    isAnonymous: boolean,
  ) {
    await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
      this.repo.toggleReaction(tx, false, isAnonymous, {
        target_id: dishMediaId,
        action_type: actionType,
        user_id: userId,
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/impression                    */
  /* ------------------------------------------------------------------ */
  async addImpression(
    dish_media_id: string,
    user_id: string,
    dto: DishMediaImpressionBodyDto,
  ) {
    try {
      await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
        this.repo.addImpression(tx, { ...dto, dish_media_id, user_id }),
      );
    } catch (error) {
      const violation = this.resolveDishMediaTimingForeignKeyViolation(error);
      if (!violation) throw error;

      this.logger.warn(
        'DishMediaImpressionForeignKeyViolation',
        'addImpression',
        {
          dishMediaId: dish_media_id,
          impressionId: dto.id,
          userId: user_id,
          sessionId: dto.session_id,
          source: dto.source,
          fieldName: violation.fieldName,
        },
      );
    }
  }

  /**
   * #1223 【設計】impression / view のタイミング障害だけを握るための判定。
   *
   * これは **二次対策（防御）** であって根本原因ではない。根本は
   * `POST /v1/dishes/bulk-import` が「まだ DB に無い dish_media.id」を返していたことで、
   * 一次対策として bulk-import 側が同期で行を upsert するようになった
   * （dishes.service.ts の upsertGoogleImportRowsSynchronously）。
   *
   * よってここで数える warn は **一次対策が効いていれば 0 に収束するはず** の残存分である。
   * DishMediaImpressionForeignKeyViolation / DishMediaViewForeignKeyViolation が
   * 増えていたら握りつぶしを疑うのではなく、
   *   1. bulk-import の BulkImportSyncUpsertError（同期 upsert の失敗）
   *   2. 同期 upsert を経由しない別経路からの dish_media.id 配布
   * を先に疑うこと。この warn を消すために閾値を緩めてはいけない。
   *
   * 【設計】握るのは P2003（FK 違反）のみ。この 2 経路が書き込むのは
   * dish_media_impressions / dish_media_views / dish_media_analysis_results の 3 テーブルで、
   * そこに定義されている FK は dish_media_id と impression_id しか無い（schema.prisma）。
   * したがって field_name が取れないケースもタイミング障害と断定してよい。
   * それ以外のエラー（P2002 や接続断など）は従来どおり 500 として伝播させる。
   *
   * instanceof ではなく code のダック判定にしているのは、`$transaction` を通した
   * 再 throw やモジュール実体の二重ロードで instanceof が落ちるのを避けるため。
   */
  private resolveDishMediaTimingForeignKeyViolation(
    error: unknown,
  ): { fieldName: string } | null {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== 'P2003') return null;

    const meta = (error as { meta?: Record<string, unknown> } | null)?.meta;
    const rawFieldName = meta?.field_name ?? meta?.constraint;
    if (typeof rawFieldName !== 'string') {
      return { fieldName: 'unknown' };
    }

    const isDishMediaTimingFk = ['dish_media_id', 'impression_id'].some(
      (column) => rawFieldName.includes(column),
    );
    return isDishMediaTimingFk ? { fieldName: rawFieldName } : null;
  }
}
