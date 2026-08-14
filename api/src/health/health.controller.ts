// api/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { BaseResponse } from '@shared/v1/res';

interface HealthData {
  status: 'ok';
  timestamp: string;
}

interface LivezData {
  status: 'ok';
}

/**
 * HealthController
 *
 * 2 つのエンドポイントは目的が違う。用途に応じて叩き分けること。
 *
 * | path     | 意味                       | 想定利用者                   | メンテ中 |
 * | -------- | -------------------------- | ---------------------------- | -------- |
 * | /health  | 正常に配信できる (readiness) | フロントの起動時チェック等   | 503      |
 * | /livez   | プロセスが応答する (liveness) | 外形監視 (uptime check)      | 200      |
 *
 * - 平常時：200（実装規定のフォーマットで）
 * - メンテ時：グローバル検査で 503
 * - 旧バージョン：グローバル検査で 426
 *
 * 注意：/health は MaintenanceGuard の対象であり、許可パスには登録しない
 * （= ガードが効く）。/livez は逆に許可パスへ登録してある。
 */
@Controller()
export class HealthController {
  @Get('health')
  getHealth(): HealthData {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 外形監視 (Cloud Monitoring の uptime check) 専用の liveness エンドポイント。
   *
   * 【設計】依存を一切持たせない。DB も GCS も RemoteConfig も参照しない。
   * MaintenanceGuard は毎リクエストで RemoteConfig（= GCS 読み）を叩くため、
   * このパスを `allowedPaths` に登録して依存から外してある。監視対象が外部依存を
   * 持つと、GCS の一時障害を「API 停止」としてページャに流してしまう。
   *
   * 【設計】メンテナンス中も 200 を返す。計画メンテのたびに本番障害として鳴るのを
   * 防ぐため。「正常に配信できるか」を知りたい用途では /health を使うこと。
   */
  @Get('livez')
  getLivez(): LivezData {
    return { status: 'ok' };
  }
}
