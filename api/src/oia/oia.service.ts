// api/src/oia/oia.service.ts
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * OIA (Open In App) Relay Service
 *
 * Universal Link 安定化のための URL 検証・リダイレクトサービス
 * - iOS Safari/Chrome の同一ドメイン内リンク抑止を回避
 * - 別オリジン（api.nanitabeyo.net）経由で外部起点に寄せる
 */
@Injectable()
export class OiaService {
  // #713 【セキュリティ】許可するホスト（allowlist）
  private readonly ALLOWED_HOSTS = ['app.nanitabeyo.net'];
  // #713 【セキュリティ】許可するプロトコル
  private readonly ALLOWED_PROTOCOL = 'https:';
  // #713 【セキュリティ】URL 最大長（2KB）
  private readonly MAX_URL_LENGTH = 2048;

  /**
   * リダイレクト先 URL を検証
   * @param targetUrl リダイレクト先 URL（エンコード済み）
   * @returns 検証済み URL オブジェクト
   * @throws BadRequestException URL が不正な場合
   * @throws ForbiddenException プロトコル/ホストが許可されていない場合
   */
  validateTargetUrl(targetUrl: string): URL {
    // #713 【セキュリティ】u パラメータ必須チェック
    if (!targetUrl || targetUrl.trim() === '') {
      throw new BadRequestException('Missing required parameter: u');
    }

    // #713 【セキュリティ】URL 長チェック（DoS 対策）
    if (targetUrl.length > this.MAX_URL_LENGTH) {
      throw new BadRequestException('URL too long');
    }

    // #713 【セキュリティ】URL パース可能性チェック
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (error) {
      throw new BadRequestException('Invalid URL format');
    }

    // #713 【セキュリティ】プロトコル検証（https のみ）
    if (parsedUrl.protocol !== this.ALLOWED_PROTOCOL) {
      throw new ForbiddenException('Only HTTPS protocol is allowed');
    }

    // #713 【セキュリティ】ホスト検証（allowlist）
    if (!this.ALLOWED_HOSTS.includes(parsedUrl.host)) {
      throw new ForbiddenException(
        `Host not allowed. Allowed hosts: ${this.ALLOWED_HOSTS.join(', ')}`,
      );
    }

    return parsedUrl;
  }
}
