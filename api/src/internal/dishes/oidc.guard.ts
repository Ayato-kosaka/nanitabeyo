// api/src/internal/bdishes/oidc.guard.ts
//
// Cloud Tasks からの OIDC トークン検証ガード
//

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { env } from '../../core/config/env';
import { OAuth2Client } from 'google-auth-library';

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
  private client = new OAuth2Client();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (env.CLOUD_RUN_URL.startsWith('http://localhost')) {
      this.logger.debug(
        'Running in local environment, skipping OIDC verification',
      );
      return true;
    }

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
   * - 署名の検証
   * - exp（有効期限）の検証
   * - aud（オーディエンス）の検証
   * - iss（発行者）の検証
   * - email の検証（許可されたサービスアカウントのみ）
   */
  private async verifyOIDCToken(token: string): Promise<void> {
    const audience = `${env.CLOUD_RUN_URL}/internal/dishes`;
    const allowedSa = env.TASKS_INVOKER_SA.toLowerCase();

    // 1) IDトークン検証（署名/exp/aud/iss）
    const ticket = await this.client.verifyIdToken({
      idToken: token,
      audience,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new UnauthorizedException('Invalid token');
    if (payload.iss !== 'https://accounts.google.com') {
      throw new UnauthorizedException('Invalid issuer');
    }
    const email = (payload.email || '').toLowerCase();
    if (email !== allowedSa) {
      throw new ForbiddenException('Service account not allowed');
    }

    this.logger.debug('OIDCGuard: Token verification completed');
  }
}
