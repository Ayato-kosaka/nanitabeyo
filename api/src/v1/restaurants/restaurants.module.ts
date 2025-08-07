import { Module } from '@nestjs/common';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsRepository } from './restaurants.repository';
import { RestaurantsMapper } from './restaurants.mapper';
import { GooglePlacesModule } from '../../core/google-places/google-places.module';
import { PaymentModule } from '../../core/payment/payment.module';
import { StorageModule } from '../../core/storage/storage.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';

@Module({
  imports: [
    GooglePlacesModule,
    PaymentModule,
    StorageModule,
    PrismaModule,
    LoggerModule,
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, RestaurantsRepository, RestaurantsMapper],
  exports: [RestaurantsService, RestaurantsRepository],
})
export class RestaurantsModule {}
