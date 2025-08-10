import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './auth.guard';
import { CLS_KEY_USER_ID } from '../cls/cls.constants';

describe('Auth Guards CLS User ID Fix', () => {
  let jwtAuthGuard: JwtAuthGuard;
  let optionalJwtAuthGuard: OptionalJwtAuthGuard;
  let clsService: jest.Mocked<ClsService>;

  beforeEach(async () => {
    const mockClsService = {
      set: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        {
          provide: ClsService,
          useValue: mockClsService,
        },
      ],
    }).compile();

    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
    optionalJwtAuthGuard =
      module.get<OptionalJwtAuthGuard>(OptionalJwtAuthGuard);
    clsService = module.get(ClsService);
  });

  describe('JwtAuthGuard', () => {
    it('should set CLS user ID using user.userId (not user.id)', () => {
      const mockUser = {
        userId: 'test-user-123',
        token: 'test-token',
      };

      const result = jwtAuthGuard.handleRequest(
        null, // err
        mockUser, // user
        null, // info
        {} as ExecutionContext, // ctx
      );

      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_USER_ID,
        'test-user-123',
      );
      expect(result).toBe(mockUser);
    });

    it('should throw UnauthorizedException when user is null', () => {
      expect(() => {
        jwtAuthGuard.handleRequest(
          null, // err
          null, // user
          'Token invalid', // info
          {} as ExecutionContext, // ctx
        );
      }).toThrow(UnauthorizedException);

      expect(clsService.set).not.toHaveBeenCalled();
    });

    it('should throw error when err is provided', () => {
      const error = new Error('JWT error');

      expect(() => {
        jwtAuthGuard.handleRequest(
          error, // err
          { userId: 'test' }, // user
          null, // info
          {} as ExecutionContext, // ctx
        );
      }).toThrow(error);

      expect(clsService.set).not.toHaveBeenCalled();
    });
  });

  describe('OptionalJwtAuthGuard', () => {
    it('should set CLS user ID when user is present with userId', () => {
      const mockUser = {
        userId: 'anonymous-user-456',
        token: 'test-token',
      };

      const result = optionalJwtAuthGuard.handleRequest(
        null, // err
        mockUser, // user
        null, // info
        {} as ExecutionContext, // ctx
      );

      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_USER_ID,
        'anonymous-user-456',
      );
      expect(result).toBe(mockUser);
    });

    it('should not set CLS when user is null', () => {
      const result = optionalJwtAuthGuard.handleRequest(
        null, // err
        null, // user
        null, // info
        {} as ExecutionContext, // ctx
      );

      expect(clsService.set).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should not set CLS when user exists but has no userId', () => {
      const mockUserWithoutUserId = {
        token: 'test-token',
        // no userId property
      };

      const result = optionalJwtAuthGuard.handleRequest(
        null, // err
        mockUserWithoutUserId, // user
        null, // info
        {} as ExecutionContext, // ctx
      );

      expect(clsService.set).not.toHaveBeenCalled();
      expect(result).toBe(mockUserWithoutUserId);
    });

    it('should handle Supabase anonymous user correctly', () => {
      const supabaseAnonymousUser = {
        userId: 'anonymous-user-uuid-123',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      };

      const result = optionalJwtAuthGuard.handleRequest(
        null,
        supabaseAnonymousUser,
        null,
        {} as ExecutionContext,
      );

      expect(clsService.set).toHaveBeenCalledWith(
        CLS_KEY_USER_ID,
        'anonymous-user-uuid-123',
      );
      expect(result).toBe(supabaseAnonymousUser);
    });
  });
});
