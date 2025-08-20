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
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    LoggerModule,
    forwardRef(() => AuthModule), // For JWT Guards and CurrentUser decorator
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    UsersMapper,
    DishMediaRepository,
    DishMediaService,
    DishCategoriesRepository,
  ],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
