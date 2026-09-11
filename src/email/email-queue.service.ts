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

// Neither job had any attempts/backoff before this — BullMQ's default of 1 attempt meant a
// transient Brevo failure (a momentary API blip, a rate limit) was never retried, only logged.
// A lower attempts count than CheckoutQueueService's refund job (5) is appropriate here: a missed
// email is a UX gap, not the financial liability an unrefunded payment is.
const EMAIL_JOB_RETRY_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

// The only thing AuthService talks to — never the raw queue, never EmailService directly.
// Keeps "swap the email transport" a change confined to this module.
@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue) {}

  async enqueuePasswordResetEmail(data: PasswordResetJobData): Promise<void> {
    // removeOnComplete: the job payload carries the raw reset token — the one place a raw
    // token is ever handled, per business-invariants.md. Don't let it linger in Redis.
    await this.emailQueue.add(EmailJobName.PasswordReset, data, {
      ...EMAIL_JOB_RETRY_OPTIONS,
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }

  async enqueuePasswordChangedEmail(
    data: PasswordChangedJobData,
  ): Promise<void> {
    await this.emailQueue.add(EmailJobName.PasswordChanged, data, {
      ...EMAIL_JOB_RETRY_OPTIONS,
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
