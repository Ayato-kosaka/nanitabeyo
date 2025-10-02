import type { RequestUser } from '../../core/auth/auth.types';

declare global {
  namespace Express {
    interface User extends RequestUser {}
    interface Request {
      user?: User;
    }
  }
}

export {};
