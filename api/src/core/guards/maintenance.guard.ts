// api/src/core/guards/maintenance.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request } from 'express';
import { RemoteConfigService } from '../remote-config/remote-config.service';
import { isVersionGreaterOrEqual } from '../utils/version.util';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_APP_VERSION } from '../cls/cls.constants';

/**
 * 🔒 メンテナンス・バージョン制御ガード
 *
 * GCS上の設定に基づき、全APIでメンテナンス・強制アップデートを制御
 * - is_maintenance === 'true' → HTTP 503 Service Unavailable
 * - X-App-Version < minimum_supported_version → HTTP 426 Upgrade Required
 * - X-App-Version 未送信時は検査スキップ（通す）
 * - 許可パスは /metrics 等の必要最小限のみ
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  /**
   * 許可するパス（メンテナンス・バージョンチェックを行わない）
   *
   * `/livez` は外形監視専用の liveness エンドポイント。ここから外すと 2 つ壊れる。
   *   1. 計画メンテのたびに 503 になり、本番障害としてページャが鳴る
   *   2. この guard が毎回読む RemoteConfig（GCS）に監視が依存してしまい、
   *      GCS の一時障害を「API 停止」と誤検知する
   * 「正常に配信できるか」を見たい用途は `/health`（= ガード対象）を使うこと。
   */
  private readonly allowedPaths = ['/metrics', '/livez'];

  constructor(
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.url.split('?')[0]; // クエリパラメータを除外

    // 許可パスはチェックをスキップ
    if (this.allowedPaths.includes(path)) {
      return true;
    }

    try {
      // GCS設定から値を取得
      const [isMaintenanceStr, minimumVersionStr] = await Promise.all([
        this.remoteConfigService.getRemoteConfigValue('is_maintenance'),
        this.remoteConfigService.getRemoteConfigValue(
          'minimum_supported_version',
        ),
      ]);

      const isMaintenance = isMaintenanceStr === 'true';

      // メンテナンス中の場合
      if (isMaintenance) {
        throw new HttpException(
          {
            data: null,
            success: false,
            errorCode: 'SERVICE_MAINTENANCE',
            message: 'Service is currently under maintenance',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      // バージョンチェック（X-App-Version未送信時はスキップ）
      const appVersion = request.headers['x-app-version'] as string;
      if (appVersion) {
        this.cls.set(CLS_KEY_APP_VERSION, appVersion);
        if (!isVersionGreaterOrEqual(appVersion, minimumVersionStr)) {
          throw new HttpException(
            {
              data: null,
              success: false,
              errorCode: 'UNSUPPORTED_VERSION',
              message: `App version ${appVersion} is no longer supported. Minimum required version: ${minimumVersionStr}`,
            },
            426, // HTTP 426 Upgrade Required
          );
        }
      }

      return true;
    } catch (error) {
      // HttpExceptionはそのまま再投
      if (error instanceof HttpException) {
        throw error;
      }

      // GCS設定取得エラー等の場合はフォールバック（通す）
      console.warn(
        'MaintenanceGuard: Failed to retrieve configuration, allowing request:',
        error,
      );
      return true;
    }
  }
}
