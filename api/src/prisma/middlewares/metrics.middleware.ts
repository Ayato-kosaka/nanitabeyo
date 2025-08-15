import { PrismaClient } from '../../../../shared/prisma/client';
import { performance } from 'node:perf_hooks';
import {
  Counter,
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
