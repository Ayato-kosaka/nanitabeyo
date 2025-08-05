import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ClsService } from 'nestjs-cls';
import { REQUEST_ID_HEADER } from './request-id.constants';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const res = ctx.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => {
        const reqId = this.cls.get<string>(CLS_KEY_REQUEST_ID);
        if (reqId) res.setHeader(REQUEST_ID_HEADER, reqId);
      }),
    );
  }
}
