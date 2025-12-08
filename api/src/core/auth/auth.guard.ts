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
import { RequestUser } from './auth.types';
import { extractBearerToken } from './auth.utils';

/* ---------------------------------------------------------------- */
/*     AuthUserGuard: ログイン必須 (匿名ユーザーは拒否) ガード      */
/* ---------------------------------------------------------------- */
@Injectable()
export class AuthUserGuard extends AuthGuard(JWT_STRATEGY) {
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
      this.logger.warn('AuthGuard', 'AuthUserGuard', {
        reason: info?.message ?? err,
      });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    if (user.isAnonymous) {
      this.logger.warn('AuthGuard', 'AuthUserGuard', {
        reason: 'Full login required',
      });
      throw new ForbiddenException('FORBIDDEN');
    }

    this.cls.set(CLS_KEY_USER_ID, user.id);
    return user as TUser;
  }
}

/* ---------------------------------------------------------------- */
/*   AuthAnonGuard: JWT が正しければ匿名でも認証成功とするガード    */
/* ---------------------------------------------------------------- */
@Injectable()
export class AuthAnonGuard extends AuthGuard(JWT_STRATEGY) {
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
      this.logger.warn('AuthGuard', 'AuthAnonGuard', {
        reason: info?.message ?? err,
      });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // token なし
    if (!token) {
      this.logger.warn('AuthGuard', 'AuthAnonGuard', {
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
