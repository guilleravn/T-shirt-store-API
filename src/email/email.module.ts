import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from './email.constants';
import { EmailService } from './email.interface';
import { BrevoEmailService } from './brevo-email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [
    // Swapping providers later (or back to a stub for a given environment) is this one line —
    // AuthService and EmailProcessor only ever depend on the EmailService abstraction.
    { provide: EmailService, useClass: BrevoEmailService },
    EmailQueueService,
    EmailProcessor,
  ],
  exports: [EmailQueueService],
})
export class EmailModule {}
