import { Prisma } from '../../../../shared/prisma/client';
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

/* -------------------------------------------------------------------------- */
/*                           Prisma Metrics Middleware                        */
/* -------------------------------------------------------------------------- */
export const MetricsMiddleware: Prisma.Middleware = async (params, next) => {
    const start = performance.now();
    let span: Span | undefined;

    // ─── OpenTelemetry span (Optional) ───────────────────────────
    try {
        const tracer = trace.getTracer('prisma');
        span = tracer.startSpan(`Prisma ${params.model}.${params.action}`, {
            attributes: {
                'db.system': 'postgresql',
                'db.operation': params.action,
                'db.prisma.model': params.model ?? 'raw',
            },
        });
    } catch {
        /* tracer 未初期化でも黙殺 */
    }

    try {
        const result = await next(params);
        recordMetrics('success', performance.now() - start, span);
        return result;
    } catch (error) {
        recordMetrics('error', performance.now() - start, span, error as Error);
        throw error;
    }

    // ─── 共通メトリクス処理 ────────────────────────────────────
    function recordMetrics(
        status: 'success' | 'error',
        duration: number,
        span?: Span,
        err?: Error,
    ) {
        const model = params.model ?? 'raw';
        const { action } = params;

        queryCounter.labels(model, action, status).inc();
        queryLatency.labels(model, action, status).observe(duration);

        if (span) {
            span.setAttribute('db.duration_ms', duration);
            if (status === 'error' && err) {
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            }
            span.end();
        }
    }
};

/* -------------------------------------------------------------------------- */
/*                              Export Registry                               */
/* -------------------------------------------------------------------------- */
/**
 * Prometheus 用エンドポイントで
 * `registry.metrics()` を返却できるよう、Module 側から export しておく。
 */
export { registry as metricsRegistry };
