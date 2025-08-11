// api/src/core/cloud-tasks/cloud-tasks.service.ts
//
// Cloud Tasks サービス（シンプル化）
// 責務: bulk import ジョブのエンキューのみ
//

import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { BulkImportJobPayload } from '../../internal/dishes/bulk-import-job.interface';

@Injectable()
export class CloudTasksService {
  private client: CloudTasksClient;

  constructor(private readonly logger: AppLoggerService) {
    this.client = new CloudTasksClient();
  }

  /**
   * bulk import ジョブをキューに追加
   */
  async enqueueBulkImportJob(payload: BulkImportJobPayload, queueName: string): Promise<void> {
    const queuePath = this.client.queuePath(
      env.GCP_PROJECT,
      env.TASKS_LOCATION,
      queueName,
    );

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${env.CLOUD_RUN_URL}/internal/dishes/execute`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: env.TASKS_INVOKER_SA,
          audience: `${env.CLOUD_RUN_URL}/internal/dishes/execute`,
        },
      },
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });

      this.logger.log('CloudTaskEnqueued', 'enqueueBulkImportJob', {
        taskName: response.name,
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
        queueName,
      });
    } catch (error) {
      this.logger.error('CloudTaskEnqueueError', 'enqueueBulkImportJob', {
        jobId: payload.jobId,
        queueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
