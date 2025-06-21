import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { logBackendEvent } from '../../lib/log';

@Injectable()
export class HelloService {
  getHello(): string {
    const requestId = nanoid(12);
    void logBackendEvent({
      event_name: 'helloCalled',
      error_level: 'INFO',
      function_name: 'HelloService.getHello',
      user_id: 'anonymous',
      payload: {},
      request_id: requestId,
    });
    return 'Hello from v1';
  }
}
