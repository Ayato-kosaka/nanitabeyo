import { Module } from '@nestjs/common';
import { HelloModule } from './hello/hello.module';
import { DishMediaModule } from './dish-media/dish-media.module';
import { DishMediaImportsModule } from './dish-media-imports/dish-media-imports.module';
import { DishCategoriesModule } from './dish-categories/dish-categories.module';
import { DishCategoryVariantsModule } from './dish-category-variants/dish-category-variants.module';
import { DishReviewsModule } from './dish-reviews/dish-reviews.module';
import { DishesModule } from './dishes/dishes.module';
import { LocationsModule } from './locations/locations.module';
import { UsersModule } from './users/users.module';
import { FeedbackModule } from './feedback/feedback.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { UserUploadsModule } from './user-uploads/user-uploads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LogsModule } from './logs/logs.module';
import { ContributionTasksModule } from './contribution-tasks/contribution-tasks.module';
import { DishCategoryGroupVotesModule } from './dish-category-group-votes/dish-category-group-votes.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { ContentReportsModule } from './content-reports/content-reports.module';

@Module({
  imports: [
    HelloModule,
    DishMediaModule,
    DishMediaImportsModule,
    DishCategoriesModule,
    DishCategoryVariantsModule,
    DishReviewsModule,
    DishesModule,
    LocationsModule,
    UsersModule,
    FeedbackModule,
    RestaurantsModule,
    UserUploadsModule,
    NotificationsModule,
    LogsModule,
    ContributionTasksModule,
    DishCategoryGroupVotesModule,
    ShareLinksModule,
    ContentReportsModule,
  ],
})
export class V1Module {}
