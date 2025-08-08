import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '../../../shared/prisma/client';
import { MetricsMiddleware } from './middlewares/metrics.middleware';

/**
 * PrismaService
 * ----------------------------------------------------------------------------
 * - PrismaClient を DI し、Nest ライフサイクルに合わせて init / destroy
 * - `$transaction()` ヘルパ & QueryMiddleware で共通ロギング／メトリクス
 * - Graceful shutdown 対応 (`app.enableShutdownHooks()` とセットで使用)
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // ★ 注意：ここで log レベルを細かく制御すると、開発時の読みやすさ向上
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['warn', 'error'],
    });

    // ─── Middleware & Extensions ───────────────────────────────
    // 例：共通ミドルウェアで全クエリの実行時間をメトリクス化
    this.$use(MetricsMiddleware);
  }

  // ----- Nest Lifecycle ---------------------------------------

  async onModuleInit() {
    this.logger.log('PrismaConnecting');
    await this.$connect();
    this.logger.log('PrismaConnected');

    // （任意）マイグレーションを自動で当てたい場合
    // if (process.env.NODE_ENV !== 'production') {
    //   await this.$executeRaw`SELECT 1`; // 例: 接続確認
    // }
  }

  async onModuleDestroy() {
    this.logger.log('PrismaDisconnecting');
    await this.$disconnect();
  }

  // ----- Helper Utilities -------------------------------------

  /**
   * `withTransaction()` – サービス層で簡単にトランザクションを張るためのユーティリティ
   *
   * @example
   * return this.prisma.withTransaction(async (tx) => {
   *   await tx.dish_media.create({ data: … });
   *   await tx.dish_likes.createMany({ data: … });
   * });
   */
  async withTransaction<T>(
    exec: (tx: Prisma.TransactionClient) => Promise<T>,
    opts?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    return this.$transaction((tx) => exec(tx), opts);
  }
}
