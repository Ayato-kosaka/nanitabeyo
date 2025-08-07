import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';
import { DishCategoriesModule } from './dish-categories/dish-categories.module';
import { DishCategoryVariantsModule } from './dish-category-variants/dish-category-variants.module';
import { DishReviewsModule } from './dish-reviews/dish-reviews.module';
import { DishesModule } from './dishes/dishes.module';
import { LocationsModule } from './locations/locations.module';
import { NotifierModule } from 'src/core/notifier/notifier.module';

@Module({
  imports: [
    HelloModule,
    DishMediaModule,
    DishCategoriesModule,
    DishCategoryVariantsModule,
    DishReviewsModule,
    DishesModule,
    LocationsModule,
    NotifierModule,
  ],
})
export class V1Module {}
