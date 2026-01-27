// api/src/oia/oia.module.ts
import { Module } from '@nestjs/common';
import { OiaController } from './oia.controller';
import { OiaService } from './oia.service';

/**
 * OIA (Open In App) Relay Module
 *
 * iOS Universal Link 安定化のためのリダイレクト機能を提供
 */
@Module({
  controllers: [OiaController],
  providers: [OiaService],
})
export class OiaModule {}
