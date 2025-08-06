import { Prisma } from '../../../../shared/prisma';
import { NonNullableFields, NullableField } from '../utils/type-utils';

export type CreateBackendEventInput = NonNullableFields<Required<
    Omit<
        Prisma.backend_event_logsCreateInput,
        'id' | 'user_id' | 'request_id' | 'created_commit_id' | 'created_at'
    >
>>;

export type CreateExternalApiInput = NullableField<NonNullableFields<Required<
    Omit<
        Prisma.external_api_logsCreateInput,
        'id' | 'user_id' | 'request_id' | 'created_commit_id' | 'created_at'
    >>
>, 'error_message' | 'response_payload'>;