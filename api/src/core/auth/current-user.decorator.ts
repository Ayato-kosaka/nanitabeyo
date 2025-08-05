import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQ_USER_KEY } from './auth.constants';
import { RequestUser } from './auth.types';

/**
 * @CurrentUser() user?: RequestUser
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req[REQ_USER_KEY] as RequestUser | undefined;
  },
);
