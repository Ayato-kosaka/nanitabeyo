import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { logBackendEvent } from '../log';

@Injectable()
export class HelloService {
  getHello(): string {
    void logBackendEvent({
      event_name: 'helloCalled',
      error_level: 'INFO',
      function_name: 'HelloService.getHello',
      user_id: 'anonymous',
      payload: {},
      request_id: randomUUID(),
    });
    return 'Hello from v1';
  }
}
