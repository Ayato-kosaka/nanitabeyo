# Maintenance / Forced Update Control System

This document describes the maintenance and forced update control system implemented for the nanitabeyo app. The system uses GCS configuration to control maintenance mode and app version requirements globally across all APIs.

## Overview

The system consists of two main components:
1. **Backend**: Global guard that checks maintenance status and app version requirements
2. **Frontend**: Health check and error handling for maintenance/version scenarios

## Backend Implementation

### MaintenanceGuard

Located in `api/src/core/guards/maintenance.guard.ts`, this global guard:

- Checks `is_maintenance` and `minimum_supported_version` from GCS configuration
- Returns HTTP 503 for maintenance mode
- Returns HTTP 426 for unsupported app versions
- Allows requests without `X-App-Version` header to pass through
- Excludes essential paths like `/metrics` from checks
- Gracefully falls back if GCS configuration is unavailable

### Health Endpoint

A new `/health` endpoint provides:
- Lightweight health status check
- Subject to maintenance/version guard (not exempted)
- Returns 200 in normal conditions
- Returns 503/426 when maintenance/version conditions are triggered

### Configuration Cache

The `RemoteConfigService` now includes:
- 5-minute TTL caching for performance
- Reduced GCS API calls
- Automatic cache invalidation

## Frontend Implementation

### Health Check Hook

`app-expo/hooks/useHealthCheck.ts` provides:
- Async health check on app startup
- Non-blocking UI rendering
- Automatic 503/426 error handling
- Proper dialog management

### Enhanced API Error Handling

`app-expo/hooks/useAPICall.ts` now handles:
- HTTP 503: Shows maintenance dialog
- HTTP 426: Shows forced update dialog with store redirect
- Backward compatibility with existing 403 error handling

### Integration

The health check is integrated into the app startup flow via:
- `HealthCheckInitializer` component
- Added to app layout without blocking UI
- Runs after providers are initialized

## Configuration

### GCS Configuration Values

The system reads these values from GCS static master configuration:

```json
{
  "is_maintenance": "true" | "false",
  "minimum_supported_version": "1.0.0" // SemVer format
}
```

### Environment Variables

Required environment variables for API:
- `GCS_BUCKET_NAME`: GCS bucket for static master files
- `GCS_STATIC_MASTER_DIR_PATH`: Directory path in GCS bucket

## Testing the System

### 1. Test Maintenance Mode

1. Set GCS config: `is_maintenance: "true"`
2. Make any API call with `X-App-Version` header
3. Expect HTTP 503 response
4. Frontend should show maintenance dialog

### 2. Test Version Control

1. Set GCS config: `minimum_supported_version: "2.0.0"`
2. Make API call with `X-App-Version: "1.5.0"`
3. Expect HTTP 426 response
4. Frontend should show update dialog with store redirect

### 3. Test Health Endpoint

```bash
# Normal operation
curl -H "X-App-Version: 2.0.0" http://localhost:3000/health
# Expected: 200 OK

# Maintenance mode (when is_maintenance: "true")
curl -H "X-App-Version: 2.0.0" http://localhost:3000/health
# Expected: 503 Service Unavailable

# Unsupported version (when minimum_supported_version > X-App-Version)
curl -H "X-App-Version: 1.0.0" http://localhost:3000/health
# Expected: 426 Upgrade Required

# No version header (should pass through)
curl http://localhost:3000/health
# Expected: 200 OK (guard allows through)
```

### 4. Test Graceful Fallback

1. Temporarily break GCS access or config format
2. API should continue working (allows all requests)
3. Check console for warning messages

## Monitoring and Operations

### Allowed Paths

These paths bypass maintenance/version checks:
- `/metrics` - For monitoring and health checks

### Cache Behavior

- Configuration is cached for 5 minutes
- Cache invalidation happens automatically
- Failed config loads trigger graceful fallback

### Error Response Format

All maintenance/version errors follow the standard API response format:

```typescript
{
  data: null,
  success: false,
  errorCode: 'SERVICE_MAINTENANCE' | 'UNSUPPORTED_VERSION',
  message: 'Human readable error message'
}
```

## Localization

All required error messages are available in all supported locales:
- `Error.maintenanceMessage`: Maintenance mode message
- `Error.unsupportedVersion`: Version upgrade required message
- `Common.goStore`: Store redirect button text
- `Common.ok`: Dialog confirmation button

## Development Guidelines

### Adding New Exempted Paths

To add paths that should bypass maintenance/version checks:

```typescript
// In MaintenanceGuard
private readonly allowedPaths = ['/metrics', '/new-exempted-path'];
```

### Customizing Cache TTL

To modify the configuration cache duration:

```typescript
// In RemoteConfigService
private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
```

### Adding New Configuration Values

1. Update `shared/remoteConfig/remoteConfig.schema.ts`
2. Update GCS static master data
3. Use via `RemoteConfigService.getRemoteConfigValue()`