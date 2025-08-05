import { Module, Global } from '@nestjs/common';
import { NotifierService } from './notifier.service';

@Global()
@Module({
    providers: [
        NotifierService,
    ],
    exports: [NotifierService],
})
export class NotifierModule { }
