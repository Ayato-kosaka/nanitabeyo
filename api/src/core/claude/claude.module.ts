// api/src/core/claude/claude.module.ts

import { Module } from '@nestjs/common';
import { ClaudeService } from './claude.service';

@Module({
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class ClaudeModule {}