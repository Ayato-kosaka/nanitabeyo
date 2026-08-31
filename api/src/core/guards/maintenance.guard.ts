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
import { AppLoggerService } from '../logger/logger.service';
import { ErrorCode } from '@shared/v1/res';

/**
 * 🔒 メンテナンス・バージョン制御ガード
 *
 * Remote Config（#1764 以降は Cloud Run の環境変数）に基づき、
 * 全APIでメンテナンス・強制アップデートを制御
 * - is_maintenance === 'true' → HTTP 503 Service Unavailable (SERVICE_MAINTENANCE)
 * - X-App-Version < minimum_supported_version → HTTP 426 Upgrade Required
 * - X-App-Version 未送信時は検査スキップ（通す）
 * - 許可パスは /metrics 等の必要最小限のみ
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  /**
   * 許可するパス（メンテナンス・バージョンチェックを行わない）
   *
   * `/livez` は外形監視専用の liveness エンドポイント。ここから外すと
   * 計画メンテのたびに 503 になり、本番障害としてページャが鳴る。
   * （#1764 以前は「guard が毎回読む GCS の一時障害を API 停止と誤検知する」
   * 問題もあったが、Remote Config が env 化されて消えた）
   * 「正常に配信できるか」を見たい用途は `/health`（= ガード対象）を使うこと。
   */
  private readonly allowedPaths = ['/metrics', '/livez'];

  constructor(
    private readonly remoteConfigService: RemoteConfigService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.url.split('?')[0]; // クエリパラメータを除外

    // 許可パスはチェックをスキップ
    if (this.allowedPaths.includes(path)) {
      return true;
    }

    try {
      // Remote Config（Cloud Run env）から値を取得
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
            errorCode: ErrorCode.SERVICE_MAINTENANCE,
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
              errorCode: ErrorCode.UNSUPPORTED_VERSION,
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

      // Remote Config が読めない場合はフォールバック（通す）。
      // #1764 env 化で読み取りが throw する経路は実質消えたが、fail-open の
      // 方針と「開いたことを構造化ログで観測できる」性質は維持する。
      //
      // #1599 【バグ】ここは `console.warn` で生テキストを吐いていた。api/src で
      // 構造化ログを経由しない catch はここだけである（他はすべて this.logger.*）。
      //
      // AppLoggerService は `log_type: 'backend_event_logs'` の JSON を stdout へ出し、
      // error-triage はまさにそのフィールドで BigQuery を絞り込む。生テキストは
      // その網に一切かからない。つまり **GCS / RemoteConfig が継続的に落ちていて、
      // メンテナンスモードと強制アップデートのゲートが両方 fail-open している間、
      // 自動検知には乗らず誰も気づけない**。fail-open という設計判断は妥当だが、
      // 「開いたことが見えない」のは別の問題である。
      this.logger.warn('MaintenanceConfigUnavailable', 'canActivate', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }
}
