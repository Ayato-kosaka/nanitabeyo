import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LogFlushMiddleware implements NestMiddleware {
  constructor() {}

  use(req: Request, res: Response, next: NextFunction) {
    // #487 【設計】Prisma バッファ管理廃止により、middleware は何もしない
    // Cloud Logging へのログ出力は各ログメソッド内で即座に stdout へ出力される
    next();
  }
}
