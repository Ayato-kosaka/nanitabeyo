import { NonNullableFields, NullableField } from '../utils/type-utils';

/* ------------------------------------------------------------------ */
/*                      Backend Event Log Types                        */
/* ------------------------------------------------------------------ */

export type CreateBackendEventInput = NonNullableFields<
  Required<
    Omit<
      BackendEventLogRecord,
      'id' | 'user_id' | 'request_id' | 'created_commit_id' | 'created_at'
    >
  >
>;

export type BackendEventLogRecord = {
  id: string;
  event_name?: string | null;
  error_level?: keyof typeof backend_event_logs_error_level | null;
  function_name?: string | null;
  user_id?: string | null;
  payload?: Record<string, any>;
  request_id?: string | null;
  created_at: Date | string;
  created_commit_id: string;
};

export const backend_event_logs_error_level = {
  verbose: 'verbose',
  debug: 'debug',
  log: 'log',
  warn: 'warn',
  error: 'error',
};

/* ------------------------------------------------------------------ */
/*                     External API Log Types                           */
/* ------------------------------------------------------------------ */

export type CreateExternalApiInput = NullableField<
  NonNullableFields<
    Required<
      Omit<
        ExternalApiLogRecord,
        'id' | 'user_id' | 'request_id' | 'created_commit_id' | 'created_at'
      >
    >
  >,
  'error_message' | 'response_payload'
>;

export type ExternalApiLogRecord = {
  id: string;
  request_id?: string | null;
  function_name?: string | null;
  api_name?: string | null;
  endpoint?: string | null;
  method?: string | null;
  request_payload?: Record<string, any>;
  response_payload?: Record<string, any>;
  status_code?: number | null;
  error_message?: string | null;
  response_time_ms?: number | null;
  user_id?: string | null;
  created_at: Date | string;
  created_commit_id: string;
};

/* ------------------------------------------------------------------ */
/*                     Frontend Event Log Types                          */
/* ------------------------------------------------------------------ */

export type CreateFrontendEventInput = NonNullableFields<
  Required<FrontendEventLogRecord>
>;

export type FrontendEventLogRecord = {
  id: string;
  user_id?: string | null;
  event_name?: string | null;
  error_level?: keyof typeof frontend_event_logs_error_level | null;
  path_name?: string | null;
  payload?: Record<string, any> | null;
  created_at: Date | string;
  created_app_version: string;
  created_commit_id: string;
};

export const frontend_event_logs_error_level = {
  verbose: 'verbose',
  debug: 'debug',
  log: 'log',
  warn: 'warn',
  error: 'error',
};
