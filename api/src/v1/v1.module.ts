import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';
import { NotifierModule } from 'src/core/notifier/notifier.module';

@Module({
  imports: [HelloModule, DishMediaModule, NotifierModule],
})
export class V1Module {}
