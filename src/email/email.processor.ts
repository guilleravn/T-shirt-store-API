import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EMAIL_QUEUE, EmailJobName } from './email.constants';
import { EmailService } from './email.interface';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  constructor(private readonly emailService: EmailService) {
    super();
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
