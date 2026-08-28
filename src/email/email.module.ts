import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from './email.constants';
import { EmailService } from './email.interface';
import { LoggingEmailService } from './logging-email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [
    { provide: EmailService, useClass: LoggingEmailService },
    EmailQueueService,
    EmailProcessor,
  ],
  exports: [EmailQueueService],
})
export class EmailModule {}
