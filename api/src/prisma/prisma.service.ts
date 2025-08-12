import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '../../../shared/prisma/client';
import { withMetrics } from './middlewares/metrics.middleware';
import { env } from 'src/core/config/env';

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
  private circuitOpenUntil = 0;
  private consecutiveConnFails = 0;
  private readonly OPEN_BASE_MS = 5_000; // 初回5秒
  private readonly OPEN_CAP_MS = 120_000; // 最大2分
  private readonly MAX_RETRIES = 3;

  // シングルトンパターンで接続を再利用
  readonly prisma: PrismaClient;

  constructor() {
    const enableQueryLogs = env.API_NODE_ENV !== 'production';

    if (process.env.NODE_ENV === 'production') {
      this.prisma = withMetrics(new PrismaClient({
        // 本番でも必要に応じてクエリログを Cloud Run に出力
        log: enableQueryLogs
          ? ([
            { emit: 'event', level: 'query' } as Prisma.LogDefinition,
            'warn',
            'error',
          ] as (Prisma.LogLevel | Prisma.LogDefinition)[])
          : (['warn', 'error'] as Prisma.LogLevel[]),
      }));
    } else {
      // 開発環境ではグローバルインスタンスを再利用
      if (!globalForPrisma.prisma) {
        globalForPrisma.prisma = withMetrics(new PrismaClient({
          log: enableQueryLogs
            ? ([
              { emit: 'event', level: 'query' } as Prisma.LogDefinition,
              'info',
              'warn',
              'error',
            ] as (Prisma.LogLevel | Prisma.LogDefinition)[])
            : (['info', 'warn', 'error'] as Prisma.LogLevel[]),
        }));
      }
      this.prisma = globalForPrisma.prisma;
      this.logger.log('Reusing existing Prisma client instance');
    }

    // Prisma の SQL 実行時間を構造化ログで出力（Cloud Run で見やすく）
    if (enableQueryLogs) {
      if (typeof this.prisma.$on === 'function') {
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
      } else {
        console.log('Prisma $on("query") is not available, skipping query logging');
      }
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

  private isCircuitOpen() {
    return Date.now() < this.circuitOpenUntil;
  }

  private openCircuit() {
    // 失敗回数に応じて開放時間を指数的に延ばす（ジッター付き）
    const base = Math.min(
      this.OPEN_BASE_MS * 2 ** this.consecutiveConnFails,
      this.OPEN_CAP_MS,
    );
    const jitter = Math.floor(Math.random() * 1000);
    this.circuitOpenUntil = Date.now() + base + jitter;
    this.logger.warn(`DB circuit opened for ~${Math.round(base / 1000)}s`);
  }

  private resetCircuit() {
    this.circuitOpenUntil = 0;
    this.consecutiveConnFails = 0;
  }

  private async connectWithRetry(): Promise<void> {
    this.isConnected = false; // ★ 念のため
    let attempt = 0;
    while (attempt < this.MAX_RETRIES) {
      try {
        await this.prisma.$connect();
        this.isConnected = true;
        this.resetCircuit();
        this.logger.log('PrismaConnected');
        return;
      } catch (err) {
        attempt++;
        this.consecutiveConnFails++;
        const backoff =
          Math.min(1000 * 2 ** attempt, 15_000) +
          Math.floor(Math.random() * 500);
        this.logger.warn(
          `DB connect failed (attempt ${attempt}/${this.MAX_RETRIES}). retry in ${Math.round(backoff / 1000)}s...`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    this.openCircuit();
    if (process.env.NODE_ENV !== 'development')
      throw new Error('Failed to connect DB on startup');
    this.logger.warn('Dev mode: continue without DB connection');
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
    if (this.isCircuitOpen()) {
      throw new Error('DB circuit open (temporarily unavailable)');
    }

    this.ensureConnected();
    try {
      const res = await this.prisma.$transaction((tx) => exec(tx), {
        maxWait: opts?.maxWait ?? 5000,
        timeout: opts?.timeout ?? 30000,
        isolationLevel: opts?.isolationLevel,
      });
      this.resetCircuit(); // ★ 成功したら回路を閉じる
      return res;
    } catch (error: any) {
      // ★ 到達不能系のみ失敗カウント＆回路を開く
      const msg = String(error?.message || '');
      if (
        msg.includes("Can't reach database server") ||
        msg.includes('ECONN') ||
        msg.includes('ENET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('57P01') /* admin_shutdown */ ||
        msg.includes('08006') /* conn failure */
      ) {
        this.consecutiveConnFails++;
        if (this.consecutiveConnFails >= 2) this.openCircuit();
        // 接続が死んだ可能性 → 次回 ensureConnected() で弾けるように
        this.isConnected = false;
      }
      this.logger.error(`Transaction error: ${error?.message}`, error?.stack);
      throw error;
    }
  }

  async safeLogToDb(op: () => Promise<any>, logger = console) {
    try {
      await op();
    } catch (e: any) {
      logger.warn(`[db-log-fallback] ${e?.message}`); // stdout へ
      // 必要ならメモリ/キューに退避し、後で再送
    }
  }
}
