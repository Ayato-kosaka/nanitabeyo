// api/src/core/prompt/prompt.module.ts

import { Module } from '@nestjs/common';
import { PromptService } from './prompt.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaticMasterModule } from '../static-master/static-master.module';

@Module({
  imports: [PrismaModule, StaticMasterModule],
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptModule {}
