// api/src/core/guards/maintenance.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { MaintenanceGuard } from './maintenance.guard';
import { RemoteConfigService } from '../remote-config/remote-config.service';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '../logger/logger.service';

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
  // #1599 fail-open したことが構造化ログへ残るかを見るため、代役を握っておく
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    const mockRemoteConfigService = {
      getRemoteConfigValue: jest.fn(),
    };
    const mockClsService = { set: jest.fn() } as unknown as ClsService;
    mockLogger.warn.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceGuard,
        {
          provide: RemoteConfigService,
          useValue: mockRemoteConfigService,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
        {
          provide: AppLoggerService,
          useValue: mockLogger,
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

    // 外形監視 (uptime check) が叩くパス。メンテ中に 503 を返したり、
    // RemoteConfig(GCS) を読みに行ったりするようになると監視が誤検知する。
    it('should allow /livez without reading remote config, even during maintenance', async () => {
      remoteConfigService.getRemoteConfigValue.mockResolvedValue('true'); // is_maintenance

      const request = createMockRequest('/livez');
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

    // #1599 fail-open 自体は妥当な設計判断だが、**開いたことが見えない**のは別の問題。
    // 生の console.warn は error-triage（BigQuery の log_type で絞る）の網にかからず、
    // GCS が落ち続けてメンテナンスゲートが機能しなくなっても誰も気づけなかった。
    it('should record the fail-open through the structured logger, not console', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      remoteConfigService.getRemoteConfigValue.mockRejectedValue(
        new Error('GCS connection failed'),
      );

      const request = createMockRequest('/health', {
        'x-app-version': '1.0.0',
      });

      await guard.canActivate(createMockContext(request));

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const [eventName, functionName, payload] = mockLogger.warn.mock.calls[0];
      expect(eventName).toBe('MaintenanceConfigUnavailable');
      expect(functionName).toBe('canActivate');
      // 原因を追えるだけの情報が残ること（どのパスで、何が起きたか）
      expect(payload).toMatchObject({
        path: '/health',
        error: 'GCS connection failed',
      });
      // 生テキストへ戻っていないこと
      expect(consoleWarn).not.toHaveBeenCalled();
      consoleWarn.mockRestore();
    });
  });
});
