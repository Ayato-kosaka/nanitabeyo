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
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { DishMediaModule } from '../dish-media/dish-media.module';
import { CloudTasksModule } from 'src/core/cloud-tasks/cloud-tasks.module';
import { UsersAssembler } from './users.assembler';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    LoggerModule,
    forwardRef(() => AuthModule), // For JWT Guards and CurrentUser decorator
    DishMediaModule,
    CloudTasksModule
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    UsersMapper,
    DishCategoriesRepository,
    UsersAssembler,
  ],
  exports: [UsersService, UsersRepository, UsersAssembler],
})
export class UsersModule { }
