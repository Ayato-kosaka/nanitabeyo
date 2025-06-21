import { Module } from '@nestjs/common';
import { DishMediaController } from './dish-media.controller';
import { DishMediaService } from './dish-media.service';
import { GooglePlacesService } from './google-places.service';

@Module({
  controllers: [DishMediaController],
  providers: [DishMediaService, GooglePlacesService],
})
export class DishMediaModule {}
