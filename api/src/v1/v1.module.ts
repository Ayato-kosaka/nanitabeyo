import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';

@Module({
  imports: [HelloModule, DishMediaModule],
})
export class V1Module {}
