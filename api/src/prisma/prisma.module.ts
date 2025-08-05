import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule
 * ----------------------------------------------------------------------------
 * - `@Global()` でアプリ全体に PrismaService をシングルトン提供
 * - API レイヤでは `constructor(private readonly prisma: PrismaService)` と注入
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
