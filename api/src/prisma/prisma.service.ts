import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '../../../shared/prisma/client';
import { MetricsMiddleware } from './middlewares/metrics.middleware';
import { env } from 'src/core/config/env';
import { RemoteConfigService } from 'src/core/remote-config/remote-config.service';

// グローバルなシングルトンインスタンスを作成
// これにより複数のインスタンス作成を防ぎます
const globalForPrisma = global as unknown as { prisma: PrismaClient };

/**
 * PrismaService
 * ----------------------------------------------------------------------------
 * - PrismaClient を DI し、Nest ライフサイクルに合わせて init / destroy
 * - `$transaction()` ヘルパ & QueryMiddleware で共通ロギング／メトリクス
 * - Graceful shutdown 対応 (`app.enableShutdownHooks()` とセットで使用)
 * - シングルトンパターンでグローバルに1つのインスタンスを再利用
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private connectionRetries = 0;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_INTERVAL = 3000; // 3秒

  // シングルトンパターンで接続を再利用
  readonly prisma: PrismaClient;

  constructor() {
    const enableQueryLogs = env.API_NODE_ENV !== 'production';

    if (process.env.NODE_ENV === 'production') {
      this.prisma = new PrismaClient({
        // 本番でも必要に応じてクエリログを Cloud Run に出力
        log: enableQueryLogs
          ? ([
              { emit: 'event', level: 'query' } as Prisma.LogDefinition,
              'warn',
              'error',
            ] as (Prisma.LogLevel | Prisma.LogDefinition)[])
          : (['warn', 'error'] as Prisma.LogLevel[]),
      });
      // ミドルウェアを適用
      this.prisma.$use(MetricsMiddleware);
    } else {
      // 開発環境ではグローバルインスタンスを再利用
      if (!globalForPrisma.prisma) {
        globalForPrisma.prisma = new PrismaClient({
          log: enableQueryLogs
            ? ([
                { emit: 'event', level: 'query' } as Prisma.LogDefinition,
                'info',
                'warn',
                'error',
              ] as (Prisma.LogLevel | Prisma.LogDefinition)[])
            : (['info', 'warn', 'error'] as Prisma.LogLevel[]),
        });
        globalForPrisma.prisma.$use(MetricsMiddleware);
      }
      this.prisma = globalForPrisma.prisma;
      this.logger.log('Reusing existing Prisma client instance');
    }

    // Prisma の SQL 実行時間を構造化ログで出力（Cloud Run で見やすく）
    if (enableQueryLogs) {
      // Prisma の型制約上、コンストラクタ引数の log 設定が動的だと
      // $on('query') のシグネチャが `never` になるため any で回避
      (this.prisma as any).$on('query', (e: any) => {
        // Cloud Logging の推奨フォーマットに合わせて JSON 一行で出力
        // e.params は JSON 文字列のことがあるため、そのまま出力
        const entry = {
          severity: 'DEBUG',
          type: 'prisma',
          message: 'Prisma query',
          duration_ms: e.duration,
          query: e.query,
          params: e.params,
          target: (e as any).target,
          timestamp: new Date().toISOString(),
        };
        // stdout へ
        console.log(JSON.stringify(entry));
      });
    }
  }

  // ----- Nest Lifecycle ---------------------------------------

  async onModuleInit() {
    this.logger.log('PrismaConnecting');
    await this.connectWithRetry();

    // メモリリーク防止のためのシグナルハンドラ
    process.on('SIGINT', async () => {
      await this.onModuleDestroy();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await this.onModuleDestroy();
      process.exit(0);
    });
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      this.logger.log('PrismaDisconnecting');
      try {
        await this.prisma.$disconnect();
        this.isConnected = false;
        this.logger.log('PrismaDisconnected');
      } catch (error) {
        this.logger.error('Error disconnecting Prisma', error);
      }
    }
  }

  private async connectWithRetry(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      this.connectionRetries = 0;
      this.logger.log('PrismaConnected');
    } catch (error) {
      this.connectionRetries++;
      if (this.connectionRetries <= this.MAX_RETRIES) {
        this.logger.warn(
          `Database connection failed (attempt ${this.connectionRetries}/${this.MAX_RETRIES}). Retrying in ${this.RETRY_INTERVAL / 1000} seconds...`,
        );

        // 再試行する前に少し待機
        await new Promise((resolve) =>
          setTimeout(resolve, this.RETRY_INTERVAL),
        );
        return this.connectWithRetry();
      } else {
        this.logger.error(
          `Failed to connect to database after ${this.MAX_RETRIES} attempts`,
          (error as any).stack,
        );

        if (process.env.NODE_ENV === 'development') {
          this.logger.warn(
            'Running in development mode: continuing without database connection',
          );
          // 開発モードではデータベース接続なしでも起動を続行
        } else {
          // 本番環境では例外を再スロー
          throw error;
        }
      }
    }
  }

  // ----- Helper Utilities -------------------------------------

  /**
   * データベースが接続されているかを確認する
   * 接続されていない場合は例外をスローする
   */
  ensureConnected() {
    if (!this.isConnected) {
      throw new Error('Database connection is not available');
    }
  }

  /**
   * `withTransaction()` – サービス層で簡単にトランザクションを張るためのユーティリティ
   * 接続管理を強化し、トランザクション完了後に明示的に接続を解放
   */
  async withTransaction<T>(
    exec: (tx: Prisma.TransactionClient) => Promise<T>,
    opts?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    this.ensureConnected();
    try {
      // タイムアウトを設定して長時間の接続を防止
      const transactionOpts = {
        maxWait: opts?.maxWait || 5000, // 5秒
        timeout: opts?.timeout || 30000, // 30秒
        isolationLevel: opts?.isolationLevel,
      };
      return await this.prisma.$transaction((tx) => exec(tx), transactionOpts);
    } catch (error) {
      this.logger.error(
        `Transaction error: ${(error as any).message}`,
        (error as any).stack,
      );
      throw error;
    }
  }
}
