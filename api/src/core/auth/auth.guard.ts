import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY, PERMISSIONS_KEY } from './auth.constants';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_USER_ID } from '../cls/cls.constants';
import { AppLoggerService } from '../logger/logger.service';
import { RequestUser } from './auth.types';
import { extractBearerToken } from './auth.utils';
import { Reflector } from '@nestjs/core';
import { StaticMasterService } from '../static-master/static-master.service';

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

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly staticMaster: StaticMasterService,
  ) { }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) ?? [];
    if (required.length === 0) return true;

    const request = ctx.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const userPermissions = await this.listUserPermissions(user.id);
    const has = required.every((p) => userPermissions.includes(p));

    if (!has) {
      throw new ForbiddenException(`Missing permission: ${required.join(', ')}`);
    }

    return true;
  }

  private async listUserPermissions(userId: string): Promise<string[]> {
    const permissions = await this.staticMaster.getStaticMaster('permissions');
    const role_permissions = await this.staticMaster.getStaticMaster('role_permissions');
    const user_roles = await this.staticMaster.getStaticMaster('user_roles');

    const assignedRoles = user_roles.filter(ur => ur.user_id === userId).map(ur => ur.role_id);
    const permissionIds = role_permissions
      .filter(rp => assignedRoles.includes(rp.role_id))
      .map(rp => rp.permission_id);

    const userPermissions = permissions
      .filter(p => permissionIds.includes(p.id))
      .map(p => p.name);

    return userPermissions;
  }
}
