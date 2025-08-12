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

@Injectable()
export class CloudTasksService {
  private client: CloudTasksClient;

  constructor(private readonly logger: AppLoggerService) {
    this.client = new CloudTasksClient();
  }

  /**
   * create dish media entry ジョブをキューに追加
   */
  async enqueueCreateDishMediaEntry(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    const queueName = 'dish-queue';
    const queuePath = this.client.queuePath(
      env.GCP_PROJECT,
      env.TASKS_LOCATION,
      queueName,
    );

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${env.CLOUD_RUN_URL}/internal/dishes/create`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: env.TASKS_INVOKER_SA,
          audience: `${env.CLOUD_RUN_URL}/internal/dishes`,
        },
      },
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });

      this.logger.log('CloudTaskEnqueued', 'enqueueCreateDishMediaEntry', {
        taskName: response.name,
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
        queueName,
      });
    } catch (error) {
      this.logger.error(
        'CloudTaskEnqueueError',
        'enqueueCreateDishMediaEntry',
        {
          jobId: payload.jobId,
          queueName,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      throw error;
    }
  }
}
