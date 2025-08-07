import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';
import { DishCategoriesModule } from './dish-categories/dish-categories.module';
import { DishCategoryVariantsModule } from './dish-category-variants/dish-category-variants.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { UserUploadsModule } from './user-uploads/user-uploads.module';
import { NotifierModule } from 'src/core/notifier/notifier.module';

@Module({
  imports: [
    HelloModule,
    DishMediaModule,
    DishCategoriesModule,
    DishCategoryVariantsModule,
    RestaurantsModule,
    UserUploadsModule,
    NotifierModule,
  ],
})
export class V1Module {}
