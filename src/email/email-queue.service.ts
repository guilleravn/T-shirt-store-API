import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, EmailJobName } from './email.constants';

interface PasswordResetJobData {
  to: string;
  firstName: string;
  resetToken: string;
}

interface PasswordChangedJobData {
  to: string;
  firstName: string;
}

// The only thing AuthService talks to — never the raw queue, never EmailService directly.
// Keeps "swap the email transport" a change confined to this module.
@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue) {}

  async enqueuePasswordResetEmail(data: PasswordResetJobData): Promise<void> {
    // removeOnComplete: the job payload carries the raw reset token — the one place a raw
    // token is ever handled, per business-invariants.md. Don't let it linger in Redis.
    await this.emailQueue.add(EmailJobName.PasswordReset, data, {
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }

  async enqueuePasswordChangedEmail(
    data: PasswordChangedJobData,
  ): Promise<void> {
    await this.emailQueue.add(EmailJobName.PasswordChanged, data, {
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
