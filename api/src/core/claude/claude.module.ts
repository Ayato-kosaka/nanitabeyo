// api/src/core/claude/claude.module.ts

import { Module } from '@nestjs/common';
import { ClaudeService } from './claude.service';
import { PromptModule } from '../prompt/prompt.module';
import { ExternalApiModule } from '../external-api/external-api.module';

@Module({
  imports: [PromptModule, ExternalApiModule],
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class ClaudeModule {}
