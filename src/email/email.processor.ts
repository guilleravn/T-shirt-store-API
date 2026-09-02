import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EMAIL_QUEUE, EmailJobName } from './email.constants';
import { EmailService } from './email.interface';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  // BullMQ swallows a thrown error into the job's "failed" state silently unless something
  // listens for it — without this, a bad API key or an unverified sender fails with no visible
  // trace anywhere.
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Email job ${job.id} (${job.name}) failed: ${error.message}`,
      error.stack,
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name as EmailJobName) {
      case EmailJobName.PasswordReset: {
        const { to, firstName, resetToken } = job.data as {
          to: string;
          firstName: string;
          resetToken: string;
        };
        await this.emailService.send({
          to,
          subject: 'Reset your password',
          body: `Hi ${firstName}, use this token to reset your password: ${resetToken}`,
        });
        return;
      }
      case EmailJobName.PasswordChanged: {
        const { to, firstName } = job.data as { to: string; firstName: string };
        await this.emailService.send({
          to,
          subject: 'Your password was changed',
          body: `Hi ${firstName}, your password was just changed. If this wasn't you, contact support immediately.`,
        });
        return;
      }
      default:
        throw new Error(`Unknown email job: ${job.name}`);
    }
  }
}
