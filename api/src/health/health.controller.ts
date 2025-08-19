// api/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { BaseResponse } from '@shared/v1/res';

interface HealthData {
  status: 'ok';
  timestamp: string;
}

/**
 * HealthController
 * 
 * フロントの起動直後チェック用の軽量エンドポイント
 * - 平常時：200（実装規定のフォーマットで）
 * - メンテ時：グローバル検査で 503
 * - 旧バージョン：グローバル検査で 426
 * 
 * 注意：このエンドポイントは MaintenanceGuard の対象であり、
 * 許可パスには登録しない（= ガードが効く）
 */
@Controller()
export class HealthController {
  @Get('health')
  getHealth(): BaseResponse<HealthData> {
    return {
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
      success: true,
    };
  }
}