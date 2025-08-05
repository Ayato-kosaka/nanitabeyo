import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { env } from '../config/env';
import { JwtPayload, RequestUser } from './auth.types';
import { JWT_STRATEGY } from './auth.constants';
import { extractBearerToken } from './auth.utils';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractBearerToken]),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: env.SUPABASE_JWT_SECRET,
    });
  }

  /**
   * payload → Nest user オブジェクトに変換
   * @throws UnauthorizedException token が匿名でも sub が空なら拒否
   */
  validate(payload: JwtPayload): RequestUser {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { userId: payload.sub, token: (payload as any).token };
  }
}
