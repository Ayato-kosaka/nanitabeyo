// api/src/core/claude/claude.module.ts

import { Module } from '@nestjs/common';
import { ClaudeService } from './claude.service';
import { StaticMasterService } from '../utils/static-master.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ClaudeService, StaticMasterService],
  exports: [ClaudeService],
})
export class ClaudeModule {}