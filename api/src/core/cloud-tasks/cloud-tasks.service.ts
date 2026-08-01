// api/src/core/cloud-tasks/cloud-tasks.service.ts
//
// Cloud Tasks サービス（シンプル化）
// 責務: ジョブのエンキューのみ
//

import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { CreateDishMediaEntryJobPayload } from '../../internal/dishes/create-dish-media-entry.interface';
import { NotificationJobPayload } from '../../internal/notifications/notification-job.interface';
import { ResizeImageDto } from 'src/internal/resize-image/resize-image.dto';

@Injectable()
export class CloudTasksService {
  private client: CloudTasksClient;

  constructor(private readonly logger: AppLoggerService) {
    this.client = new CloudTasksClient();
  }

  /** 共通: Cloud Tasks へ JSON POST タスクを投入 (ローカルは直接 fetch) */
  private async enqueueJsonPostTask(params: {
    url: string;
    payload: unknown;
    queueName: string;
    logAction: string; // 例: 'enqueueCreateDishMediaEntry'
    /**
     * #1053 指定すると Cloud Tasks の名前付きタスクとして積み、
     * 同名タスクの再 enqueue を ALREADY_EXISTS で弾く（完了後およそ1時間保持）。
     *
     * これが防ぐのは「enqueue の重複」だけで、handler retry の冪等性にはならない。
     * handler 側の既存チェックと併用すること。
     */
    dedupeKey?: string;
  }): Promise<void> {
    const { url, payload, queueName, logAction, dedupeKey } = params;
    const audience = env.CLOUD_RUN_URL; // OIDC audience

    if (env.CLOUD_RUN_URL.startsWith('http://localhost')) {
      // ローカルは直接呼び出し (非同期 fire & forget)
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return;
    }

    const queuePath = this.client.queuePath(
      env.GCP_PROJECT,
      env.TASKS_LOCATION,
      queueName,
    );

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: env.TASKS_INVOKER_SA,
          audience,
        },
      },
      // #1053 タスク名は queuePath 配下の相対名で、使える文字は [A-Za-z0-9_-] のみ。
      // 任意文字列を含む dedupeKey をそのまま置けないため sha256 の hex に潰す。
      ...(dedupeKey
        ? {
            name: `${queuePath}/tasks/${createHash('sha256')
              .update(dedupeKey)
              .digest('hex')}`,
          }
        : {}),
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });
      this.logger.log('CloudTaskEnqueued', logAction, {
        taskName: response.name,
        queueName,
        deduped: !!dedupeKey,
      });
    } catch (error) {
      // #1053 名前付きタスクの ALREADY_EXISTS は「既に積まれている」という
      // 正常な重複排除であって失敗ではない。ここで throw すると、呼び出し元は
      // enqueue できなかったと誤解する。
      if (dedupeKey && this.isAlreadyExistsError(error)) {
        this.logger.log('CloudTaskDeduplicated', logAction, {
          queueName,
          dedupeKey,
        });
        return;
      }
      this.logger.error('CloudTaskEnqueueError', logAction, {
        queueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /** gRPC の ALREADY_EXISTS (code 6) を判定する */
  private isAlreadyExistsError(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    if (code === 6) return true;
    const message = error instanceof Error ? error.message : '';
    return message.includes('ALREADY_EXISTS');
  }

  /** create dish media entry ジョブをキューに追加 */
  async enqueueCreateDishMediaEntry(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    const url = `${env.CLOUD_RUN_URL}/internal/dishes/create`;
    await this.enqueueJsonPostTask({
      url,
      payload: { ...payload },
      queueName: 'dish-queue',
      logAction: 'enqueueCreateDishMediaEntry',
      // #1053 同じ (placeId, categoryId) の重複 enqueue を Cloud Tasks 側で弾く。
      // handler 側の既存チェックは引き続き必要（retry には効かないため）。
      dedupeKey: payload.idempotencyKey,
    });
  }

  /** 画像リサイズジョブをキューに追加 */
  async enqueueResizeImage(params: ResizeImageDto): Promise<void> {
    const url = `${env.CLOUD_RUN_URL}/internal/resize-image`;
    await this.enqueueJsonPostTask({
      url,
      payload: { ...params },
      queueName: 'image-resize-queue',
      logAction: 'enqueueResizeImage',
    });
  }

  /** 通知ジョブをキューに追加 */
  async enqueueNotification(payload: NotificationJobPayload): Promise<void> {
    const url = `${env.CLOUD_RUN_URL}/internal/notifications/process`;
    await this.enqueueJsonPostTask({
      url,
      payload: { ...payload },
      queueName: 'notification-queue',
      logAction: 'enqueueNotification',
    });
  }
}
