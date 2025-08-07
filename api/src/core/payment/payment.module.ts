import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
