// api/src/core/supabase-admin/supabase-admin.module.ts
//
// #1511 Supabase Auth の admin API クライアント（service_role）を提供する。

import { Module } from '@nestjs/common';
import { LoggerModule } from '../logger/logger.module';
import { SupabaseAdminService } from './supabase-admin.service';

@Module({
  imports: [LoggerModule],
  providers: [SupabaseAdminService],
  exports: [SupabaseAdminService],
})
export class SupabaseAdminModule {}
