import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailService } from './email.interface';

// Stub implementation: logs instead of sending. Swap the binding in EmailModule for a real
// provider (SMTP/SES/etc.) later — nothing outside this file needs to change.
@Injectable()
export class LoggingEmailService implements EmailService {
  private readonly logger = new Logger(LoggingEmailService.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `Stub email — to: ${message.to}, subject: "${message.subject}"\n${message.body}`,
    );
    return Promise.resolve();
  }
}
