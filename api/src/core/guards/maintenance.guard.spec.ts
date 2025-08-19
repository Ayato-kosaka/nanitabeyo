// api/src/core/guards/maintenance.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { MaintenanceGuard } from './maintenance.guard';
import { RemoteConfigService } from '../remote-config/remote-config.service';

// Mock request object
const createMockRequest = (
  url: string,
  headers: Record<string, string> = {},
) => ({
  url,
  headers,
});

// Mock execution context
const createMockContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as ExecutionContext;

describe('MaintenanceGuard', () => {
  let guard: MaintenanceGuard;
  let remoteConfigService: jest.Mocked<RemoteConfigService>;

  beforeEach(async () => {
    const mockRemoteConfigService = {
      getRemoteConfigValue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceGuard,
        {
          provide: RemoteConfigService,
          useValue: mockRemoteConfigService,
        },
      ],
    }).compile();

    guard = module.get<MaintenanceGuard>(MaintenanceGuard);
    remoteConfigService = module.get(RemoteConfigService);
  });

  describe('canActivate', () => {
    it('should allow access to whitelisted paths like /metrics', async () => {
      const request = createMockRequest('/metrics');
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(remoteConfigService.getRemoteConfigValue).not.toHaveBeenCalled();
    });

    it('should allow access when maintenance is false and version is supported', async () => {
      remoteConfigService.getRemoteConfigValue
        .mockResolvedValueOnce('false') // is_maintenance
        .mockResolvedValueOnce('1.0.0'); // minimum_supported_version

      const request = createMockRequest('/health', {
        'x-app-version': '1.1.0',
      });
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access when no x-app-version header is provided', async () => {
      remoteConfigService.getRemoteConfigValue
        .mockResolvedValueOnce('false') // is_maintenance
        .mockResolvedValueOnce('1.0.0'); // minimum_supported_version

      const request = createMockRequest('/health');
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw 503 when maintenance mode is enabled', async () => {
      remoteConfigService.getRemoteConfigValue
        .mockResolvedValueOnce('true') // is_maintenance
        .mockResolvedValueOnce('1.0.0'); // minimum_supported_version

      const request = createMockRequest('/health', {
        'x-app-version': '1.1.0',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            data: null,
            success: false,
            errorCode: 'SERVICE_MAINTENANCE',
          }),
          status: HttpStatus.SERVICE_UNAVAILABLE,
        }),
      );
    });

    it('should throw 426 when app version is below minimum supported', async () => {
      remoteConfigService.getRemoteConfigValue
        .mockResolvedValueOnce('false') // is_maintenance
        .mockResolvedValueOnce('2.0.0'); // minimum_supported_version

      const request = createMockRequest('/health', {
        'x-app-version': '1.5.0',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            data: null,
            success: false,
            errorCode: 'UNSUPPORTED_VERSION',
          }),
          status: 426, // HTTP 426 Upgrade Required
        }),
      );
    });

    it('should allow access when config service fails (graceful fallback)', async () => {
      remoteConfigService.getRemoteConfigValue.mockRejectedValue(
        new Error('GCS connection failed'),
      );

      const request = createMockRequest('/health', {
        'x-app-version': '1.0.0',
      });
      const context = createMockContext(request);

      // Should not throw and should allow access
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
