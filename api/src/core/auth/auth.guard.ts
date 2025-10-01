import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY } from './auth.constants';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_USER_ID } from '../cls/cls.constants';
import { AppLoggerService } from '../logger/logger.service';
import { env } from '../config/env';
import { RequestUser } from './auth.types';
import { extractBearerToken } from './auth.utils';

/** 本ログイン必須ガード */
@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
  constructor(
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  override handleRequest<TUser = any>(
    err: any,
    user: RequestUser | undefined,
    info: any,
    _ctx: ExecutionContext,
  ): TUser {
    if (err || !user) {
      this.logger.warn('AuthGuard', 'JwtAuthGuard', { reason: info?.message ?? err });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    if (user.isAnonymous) {
      this.logger.warn('AuthGuard', 'JwtAuthGuard', {
        reason: 'Full login required',
      });
      throw new ForbiddenException('FORBIDDEN');
    }

    this.cls.set(CLS_KEY_USER_ID, user.id);
    return user as TUser;
  }
}

/** 匿名または本ログイン（DEV はモック可） */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
  private readonly isDev = env.NODE_ENV === 'development';

  constructor(
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  override handleRequest<TUser = any>(
    err: any,
    user: RequestUser | undefined,
    info: any,
    ctx: ExecutionContext,
  ): TUser {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearerToken(req);

    // token あり & 検証失敗
    if (err || (token && !user)) {
      this.logger.warn('AuthGuard', 'OptionalJwtAuthGuard', {
        reason: info?.message ?? err,
      });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // token なし
    if (!token) {
      if (this.isDev) {
        const mockUser: RequestUser = {
          id: 'dev-mock-user',
          isAnonymous: env.DEV_AUTH_IS_ANONYMOUS,
          email: 'dev@example.com',
          provider: 'mock',
          rawClaims: undefined,
        };
        this.logger.log('AuthGuard', 'OptionalJwtAuthGuard', {
          message: 'Using dev mock user',
        });
        this.cls.set(CLS_KEY_USER_ID, mockUser.id);
        return mockUser as TUser;
      }
      this.logger.warn('AuthGuard', 'OptionalJwtAuthGuard', {
        reason: 'Authorization header missing',
      });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // token あり & 検証成功
    if (user) {
      this.cls.set(CLS_KEY_USER_ID, user.id);
    }

    return user as TUser;
  }
}

