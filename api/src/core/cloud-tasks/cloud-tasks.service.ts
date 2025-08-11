// api/src/core/cloud-tasks/cloud-tasks.service.ts
//
// Cloud Tasks クライアントラッパー
//

import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { BulkImportJobPayload } from '../../internal/bulk-import/bulk-import-job.interface';

@Injectable()
export class CloudTasksService {
  private client: CloudTasksClient;
  private queuePath: string;

  constructor(private readonly logger: AppLoggerService) {
    this.client = new CloudTasksClient();
    this.queuePath = this.client.queuePath(
      env.GCP_PROJECT,
      env.TASKS_LOCATION,
      'bulk-import-queue', // キュー名は固定
    );
  }

  /**
   * bulk import ジョブをキューに追加
   */
  async enqueueBulkImportJob(payload: BulkImportJobPayload): Promise<void> {
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${env.CLOUD_RUN_URL}/internal/bulk-import/execute`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: env.TASKS_INVOKER_SA,
          audience: `${env.CLOUD_RUN_URL}/internal/bulk-import/execute`,
        },
      },
    };

    try {
      const [response] = await this.client.createTask({
        parent: this.queuePath,
        task,
      });

      this.logger.log('CloudTaskEnqueued', 'enqueueBulkImportJob', {
        taskName: response.name,
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('CloudTaskEnqueueError', 'enqueueBulkImportJob', {
        jobId: payload.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * キューのヘルスチェック
   */
  async checkQueueHealth(): Promise<boolean> {
    try {
      const [queue] = await this.client.getQueue({ name: this.queuePath });
      return queue.state === 'RUNNING';
    } catch (error) {
      this.logger.error('QueueHealthCheckError', 'checkQueueHealth', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}