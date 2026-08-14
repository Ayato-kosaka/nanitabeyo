// api/src/robots/robots.module.ts
import { Module } from '@nestjs/common';
import { RobotsController } from './robots.controller';

@Module({
  controllers: [RobotsController],
})
export class RobotsModule {}
