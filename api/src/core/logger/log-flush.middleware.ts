import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../config/env';
import {
  CLS_KEY_API_LOG_BUFFER,
  CLS_KEY_BE_LOG_BUFFER,
} from '../cls/cls.constants';
import {
  BufferedBackendEventLog,
  BufferedExternalApiLog,
} from './logger.types';
import * as chunk from 'lodash.chunk';

@Injectable()
export class LogFlushMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Initialize empty buffers at the start of each request
    this.cls.set<BufferedBackendEventLog[]>(CLS_KEY_BE_LOG_BUFFER, []);
    this.cls.set<BufferedExternalApiLog[]>(CLS_KEY_API_LOG_BUFFER, []);

    // Hook into response finish event to flush logs after response is sent
    res.on('finish', () => {
      // Use setImmediate to ensure this runs after the response is fully sent
      setImmediate(() => {
        this.flushLogs().catch((error) => {
          // Log flush errors to console only (avoid circular logging)
          console.error('Log flush error:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          });
        });
      });
    });

    next();
  }

  private async flushLogs(): Promise<void> {
    const beBuffer = this.cls.get<BufferedBackendEventLog[]>(CLS_KEY_BE_LOG_BUFFER) || [];
    const apiBuffer = this.cls.get<BufferedExternalApiLog[]>(CLS_KEY_API_LOG_BUFFER) || [];

    // Flush backend event logs if any
    if (beBuffer.length > 0) {
      await this.flushBackendEventLogs(beBuffer);
    }

    // Flush external API logs if any
    if (apiBuffer.length > 0) {
      await this.flushExternalApiLogs(apiBuffer);
    }
  }

  private async flushBackendEventLogs(logs: BufferedBackendEventLog[]): Promise<void> {
    try {
      const chunks = chunk(logs, env.LOG_BATCH_MAX);
      
      for (const chunk of chunks) {
        await this.prisma.prisma.backend_event_logs.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
    } catch (error) {
      // Log error to console only (avoid circular logging)
      console.error('Backend event logs flush error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: logs.length,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async flushExternalApiLogs(logs: BufferedExternalApiLog[]): Promise<void> {
    try {
      const chunks = chunk(logs, env.LOG_BATCH_MAX);
      
      for (const chunk of chunks) {
        await this.prisma.prisma.external_api_logs.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
    } catch (error) {
      // Log error to console only (avoid circular logging)
      console.error('External API logs flush error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: logs.length,
        timestamp: new Date().toISOString(),
      });
    }
  }
}