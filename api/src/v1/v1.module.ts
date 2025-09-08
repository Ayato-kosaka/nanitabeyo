import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';
import { DishCategoriesModule } from './dish-categories/dish-categories.module';
import { DishCategoryVariantsModule } from './dish-category-variants/dish-category-variants.module';
import { DishReviewsModule } from './dish-reviews/dish-reviews.module';
import { DishesModule } from './dishes/dishes.module';
import { LocationsModule } from './locations/locations.module';
import { UsersModule } from './users/users.module';
import { FeedbackModule } from './feedback/feedback.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { UserUploadsModule } from './user-uploads/user-uploads.module';
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
    UsersModule,
    FeedbackModule,
    RestaurantsModule,
    UserUploadsModule,
    NotifierModule,
  ],
})
export class V1Module {}
