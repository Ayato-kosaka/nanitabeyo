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
  /** 許可するパス（メンテナンス・バージョンチェックを行わない） */
  private readonly allowedPaths = ['/metrics'];

  constructor(private readonly remoteConfigService: RemoteConfigService) {}

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
