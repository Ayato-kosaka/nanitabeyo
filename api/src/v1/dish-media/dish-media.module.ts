import { Module } from '@nestjs/common';
import { DishMediaController } from './dish-media.controller';
import { DishMediaService } from './dish-media.service';
import { GooglePlacesService } from './google-places.service';
import { CloudVisionService } from './cloud-vision.service';

@Module({
  controllers: [DishMediaController],
  providers: [DishMediaService, GooglePlacesService, CloudVisionService],
})
export class DishMediaModule {}
