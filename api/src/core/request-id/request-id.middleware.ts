import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';

import { REQUEST_ID_HEADER } from './request-id.constants';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // ヘッダから継承 or 新規採番
    const reqId =
      (req.headers[REQUEST_ID_HEADER] as string | undefined) ?? randomUUID();

    // CLS ストアへ保存（以降の DI ツリー全域で取得可）
    this.cls.set(CLS_KEY_REQUEST_ID, reqId);

    // レスポンスにも付与しておく（Interceptor が上書き保証）
    res.setHeader(REQUEST_ID_HEADER, reqId);

    next();
  }
}
