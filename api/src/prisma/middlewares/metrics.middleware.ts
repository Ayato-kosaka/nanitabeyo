import { PrismaClient } from '../../../../shared/prisma/client';
import { performance } from 'node:perf_hooks';
import type { Pool, PoolClient } from 'pg';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { trace, Span, SpanStatusCode } from '@opentelemetry/api';

/* -------------------------------------------------------------------------- */
/*                              Metric Registry                               */
/* -------------------------------------------------------------------------- */
// prom-client は同じメトリクス名が重複すると例外を投げるため、既存を再利用
const registry: Registry = (global as any).__PROM_REGISTRY__ ?? new Registry();
(global as any).__PROM_REGISTRY__ = registry;

// アプリ起動直後に 1 回だけ Node 既定メトリクスを収集
if (!(global as any).__PROM_DEFAULT_COLLECTED__) {
  collectDefaultMetrics({ register: registry });
  (global as any).__PROM_DEFAULT_COLLECTED__ = true;
}

// ─── Query 合計件数 ─────────────────────────────────────────────
const queryCounter =
  (registry.getSingleMetric('prisma_query_total') as Counter<string>) ??
  new Counter({
    name: 'prisma_query_total',
    help: 'Total number of Prisma queries executed',
    labelNames: ['model', 'action', 'status'] as const,
    registers: [registry],
  });

// ─── Query レイテンシ (ms) ─────────────────────────────────────
const queryLatency =
  (registry.getSingleMetric(
    'prisma_query_duration_milliseconds',
  ) as Histogram<string>) ??
  new Histogram({
    name: 'prisma_query_duration_milliseconds',
    help: 'Prisma query duration in milliseconds',
    labelNames: ['model', 'action', 'status'] as const,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
    registers: [registry],
  });

// #904 【設計】Prisma 7 adapter-pgの実効Pool状態と接続取得待ち時間をNodeドライバ側で計測する
const poolTotalConnections =
  (registry.getSingleMetric('pg_pool_total_connections') as Gauge<string>) ??
  new Gauge({
    name: 'pg_pool_total_connections',
    help: 'Total number of PostgreSQL clients in the pool',
    registers: [registry],
  });

const poolIdleConnections =
  (registry.getSingleMetric('pg_pool_idle_connections') as Gauge<string>) ??
  new Gauge({
    name: 'pg_pool_idle_connections',
    help: 'Number of idle PostgreSQL clients in the pool',
    registers: [registry],
  });

const poolWaitingRequests =
  (registry.getSingleMetric('pg_pool_waiting_requests') as Gauge<string>) ??
  new Gauge({
    name: 'pg_pool_waiting_requests',
    help: 'Number of requests waiting for a PostgreSQL client',
    registers: [registry],
  });

const poolConnectionErrors =
  (registry.getSingleMetric(
    'pg_pool_connection_errors_total',
  ) as Counter<string>) ??
  new Counter({
    name: 'pg_pool_connection_errors_total',
    help: 'Total number of PostgreSQL pool connection errors',
    labelNames: ['source'] as const,
    registers: [registry],
  });

const poolAcquireLatency =
  (registry.getSingleMetric(
    'pg_pool_acquire_duration_milliseconds',
  ) as Histogram<string>) ??
  new Histogram({
    name: 'pg_pool_acquire_duration_milliseconds',
    help: 'PostgreSQL pool client acquisition duration in milliseconds',
    labelNames: ['status'] as const,
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000],
    registers: [registry],
  });

const instrumentedPools: WeakSet<Pool> =
  (global as any).__PG_POOL_METRICS_INSTRUMENTED__ ?? new WeakSet<Pool>();
(global as any).__PG_POOL_METRICS_INSTRUMENTED__ = instrumentedPools;

type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: any) => void,
) => void;

function updatePoolStateMetrics(pool: Pool): void {
  poolTotalConnections.set(pool.totalCount);
  poolIdleConnections.set(pool.idleCount);
  poolWaitingRequests.set(pool.waitingCount);
}

/**
 * pg.Pool の状態と接続取得待ち時間を既存の Prometheus registry へ登録する。
 *
 * @param pool 計測対象の pg.Pool
 * @returns 計測処理を追加した同一の pg.Pool
 * @remarks 副作用として connect をラップし、Poolイベントリスナーを追加する。
 * 失敗時は元の接続エラーを変更せず、呼び出し元へそのまま返す。
 */
export function withPoolMetrics<TPool extends Pool>(pool: TPool): TPool {
  if (instrumentedPools.has(pool)) {
    return pool;
  }
  instrumentedPools.add(pool);
  updatePoolStateMetrics(pool);

  const originalConnect = pool.connect.bind(pool) as Pool['connect'];
  pool.connect = ((callback?: PoolConnectCallback) => {
    const startedAt = performance.now();

    const observeAcquire = (status: 'success' | 'error') => {
      poolAcquireLatency.labels(status).observe(performance.now() - startedAt);
      updatePoolStateMetrics(pool);
    };

    if (callback) {
      originalConnect((error, client, done) => {
        const status = error ? 'error' : 'success';
        if (error) {
          poolConnectionErrors.labels('acquire').inc();
        }
        observeAcquire(status);
        callback(error, client, done);
      });
      return;
    }

    return originalConnect().then(
      (client) => {
        observeAcquire('success');
        return client;
      },
      (error) => {
        poolConnectionErrors.labels('acquire').inc();
        observeAcquire('error');
        throw error;
      },
    );
  }) as Pool['connect'];

  pool.on('connect', () => updatePoolStateMetrics(pool));
  pool.on('acquire', () => updatePoolStateMetrics(pool));
  // #904 【バグ】releaseイベント時点ではidleキュー反映前のため、完了後の状態を次のイベントループで計測する
  pool.on('release', () => setImmediate(() => updatePoolStateMetrics(pool)));
  pool.on('remove', () => updatePoolStateMetrics(pool));
  pool.on('error', () => {
    poolConnectionErrors.labels('idle').inc();
    updatePoolStateMetrics(pool);
  });

  return pool;
}

/* ------------------------ Prisma Client Extension ---------------------- */
/**
 * Prisma Client をメトリクス計測付きに拡張して返す
 */
export function withMetrics<TClient extends PrismaClient>(
  client: TClient,
): TClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();

          // OpenTelemetry span（任意）
          let endSpan:
            | ((status: 'success' | 'error', err?: any) => void)
            | null = null;
          try {
            const tracer = trace.getTracer('prisma');
            const span = tracer.startSpan(
              `Prisma ${model ?? 'raw'}.${operation}`,
              {
                attributes: {
                  'db.system': 'postgresql',
                  'db.operation': operation,
                  'db.prisma.model': model ?? 'raw',
                },
              },
            );
            endSpan = (status, err) => {
              const ms = performance.now() - start;
              span.setAttribute('db.duration_ms', ms);
              if (status === 'error' && err) {
                span.recordException(err);
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: String(err?.message ?? ''),
                });
              }
              span.end();
            };
          } catch {
            /* tracer 未初期化でも黙殺 */
          }

          try {
            const res = await query(args);
            const ms = performance.now() - start;
            queryCounter.labels(model ?? 'raw', operation, 'success').inc();
            queryLatency
              .labels(model ?? 'raw', operation, 'success')
              .observe(ms);
            endSpan?.('success');
            return res;
          } catch (err) {
            const ms = performance.now() - start;
            queryCounter.labels(model ?? 'raw', operation, 'error').inc();
            queryLatency.labels(model ?? 'raw', operation, 'error').observe(ms);
            endSpan?.('error', err);
            throw err;
          }
        },
      },
    },
  }) as unknown as TClient;
}

/* -------------------------------------------------------------------------- */
/*                              Export Registry                               */
/* -------------------------------------------------------------------------- */
/**
 * Prometheus 用エンドポイントで
 * `registry.metrics()` を返却できるよう、Module 側から export しておく。
 */
export { registry as metricsRegistry };
