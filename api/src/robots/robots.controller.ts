// api/src/robots/robots.controller.ts
import { Controller, Get, Header } from '@nestjs/common';
import { SkipResponseWrap } from '../core/interceptors/response-wrap.interceptor';

// #276 【設計】全クローラを拒否する robots.txt
// - version を指定しない @Controller() のため main.ts の enableVersioning()
//   による /v1, /v2 prefix が付かず、そのまま `/robots.txt` で公開される
//   （AppController の `/`, HealthController の `/health` と同じ扱い）
// - ResponseWrapInterceptor は素の text/plain を返すため @SkipResponseWrap() で除外
export const ROBOTS_TXT_BODY = 'User-agent: *\nDisallow: /\n';

@Controller()
export class RobotsController {
  @Get('robots.txt')
  @SkipResponseWrap()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  getRobotsTxt(): string {
    return ROBOTS_TXT_BODY;
  }
}
