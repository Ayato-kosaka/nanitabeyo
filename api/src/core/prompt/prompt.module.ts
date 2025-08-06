// api/src/core/prompt/prompt.module.ts

import { Module } from '@nestjs/common';
import { PromptService } from './prompt.service';
import { StaticMasterService } from '../utils/static-master.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PromptService, StaticMasterService],
  exports: [PromptService],
})
export class PromptModule {}