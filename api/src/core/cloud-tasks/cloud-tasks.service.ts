// api/src/core/cloud-tasks/cloud-tasks.service.ts
//
// Cloud Tasks サービス（シンプル化）
// 責務: ジョブのエンキューのみ
//

import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { CreateDishMediaEntryJobPayload } from '../../internal/dishes/create-dish-media-entry.interface';
import { GetResizedSignedUrlParams } from '../storage/storage.types';

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
    audience: string; // OIDC audience
  }): Promise<void> {
    const { url, payload, queueName, logAction, audience } = params;

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
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });
      this.logger.log('CloudTaskEnqueued', logAction, {
        taskName: response.name,
        queueName,
      });
    } catch (error) {
      this.logger.error('CloudTaskEnqueueError', logAction, {
        queueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
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
      audience: `${env.CLOUD_RUN_URL}/internal/dishes`,
    });
  }

  /** 画像リサイズジョブをキューに追加 */
  async enqueueResizeImage(params: GetResizedSignedUrlParams): Promise<void> {
    const url = `${env.CLOUD_RUN_URL}/internal/resize-image`;
    await this.enqueueJsonPostTask({
      url,
      payload: { ...params },
      queueName: 'image-resize-queue',
      logAction: 'enqueueResizeImage',
      audience: `${env.CLOUD_RUN_URL}/internal/resize-image`,
    });
  }
}
