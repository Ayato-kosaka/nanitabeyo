// api/src/v1/users/users.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersMapper } from './users.mapper';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../core/storage/storage.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../core/auth/auth.module';
import { DishMediaModule } from '../dish-media/dish-media.module';
import { CloudTasksModule } from 'src/core/cloud-tasks/cloud-tasks.module';
import { UsersAssembler } from './users.assembler';
import { DishCategoriesModule } from '../dish-categories/dish-categories.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { DishCategoryGroupVotesModule } from '../dish-category-group-votes/dish-category-group-votes.module';
import { SupabaseAdminModule } from '../../core/supabase-admin/supabase-admin.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    LoggerModule,
    forwardRef(() => AuthModule), // For JWT Guards and CurrentUser decorator
    DishMediaModule,
    CloudTasksModule,
    DishCategoriesModule,
    RestaurantsModule,
    DishCategoryGroupVotesModule,
    // #1511 アカウント削除で Supabase Auth のユーザーを物理削除するため
    SupabaseAdminModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, UsersMapper, UsersAssembler],
  exports: [UsersService, UsersRepository, UsersAssembler],
})
export class UsersModule {}
