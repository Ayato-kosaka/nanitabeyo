import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY } from './auth.constants';
import { ClsService } from 'nestjs-cls';
import { CLS_KEY_USER_ID } from '../cls/cls.constants';

@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
    constructor(private readonly cls: ClsService) {
        super();
    }

    // ジェネリックをそのまま残すことがポイント
    handleRequest<TUser = any>(
        err: any,
        user: any,
        info: any,
        _ctx: ExecutionContext,
        _status?: any,
    ): TUser {
        if (err || !user) {
            throw err ?? new UnauthorizedException(info);
        }
        this.cls.set(CLS_KEY_USER_ID, user.id);
        // 返却型はジェネリックなので `as TUser` で整合
        return user as TUser;
    }
}

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
    constructor(private readonly cls: ClsService) {
        super();
    }

    override handleRequest<TUser = any>(
        _err: any,
        user: any,
        _info: any,
        _ctx: ExecutionContext,
        _status?: any,
    ): TUser {
        // TODO: user を取得できるようにする。
        // this.cls.set(CLS_KEY_USER_ID, user?.id);
        // user が falsy ならそのまま undefined を返却
        // ただし型は TUser (any) にキャストして整合を取る
        return user as TUser;
    }
}
