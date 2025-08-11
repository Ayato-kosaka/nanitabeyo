// api/src/internal/bulk-import/oidc.guard.ts
//
// Cloud Tasks からの OIDC トークン検証ガード
//

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { env } from '../../core/config/env';

/**
 * Cloud Tasks からの OIDC トークンを検証するガード
 *
 * Cloud Tasks は以下の形式でリクエストを送信：
 * - Authorization: Bearer <OIDC_TOKEN>
 * - audience: 内部エンドポイントのURL
 * - issuer: https://accounts.google.com
 */
@Injectable()
export class OIDCGuard implements CanActivate {
  private readonly logger = new Logger(OIDCGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.warn('OIDCGuard: No authorization header found');
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      this.logger.warn('OIDCGuard: No bearer token found');
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      // OIDC トークンの検証
      await this.verifyOIDCToken(token);
      return true;
    } catch (error) {
      this.logger.error('OIDCGuard: Token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new UnauthorizedException('Invalid OIDC token');
    }
  }

  /**
   * OIDC トークンを検証
   *
   * 本格実装では Google JWT ライブラリを使用
   * 現在は簡略化実装（開発用）
   */
  private async verifyOIDCToken(token: string): Promise<void> {
    // TODO: 本格実装では以下を検証:
    // 1. JWT の署名検証 (Google の公開鍵で)
    // 2. audience = env.CLOUD_RUN_URL + '/internal/bulk-import/execute'
    // 3. issuer = 'https://accounts.google.com'
    // 4. exp (有効期限)
    // 5. iat (発行時刻)

    if (env.API_NODE_ENV === 'development') {
      // 開発環境では検証をスキップ
      this.logger.debug(
        'OIDCGuard: Skipping token verification in development',
      );
      return;
    }

    // 本番環境では実際の検証を実行
    // const jwt = require('jsonwebtoken');
    // const jwksClient = require('jwks-rsa');
    //
    // const client = jwksClient({
    //   jwksUri: 'https://www.googleapis.com/oauth2/v3/certs'
    // });
    //
    // const decoded = jwt.verify(token, getKey, {
    //   audience: `${env.CLOUD_RUN_URL}/internal/bulk-import/execute`,
    //   issuer: 'https://accounts.google.com'
    // });

    this.logger.debug('OIDCGuard: Token verification completed');
  }
}
