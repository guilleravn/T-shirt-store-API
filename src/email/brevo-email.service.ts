import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';
import { EmailMessage, EmailService } from './email.interface';

@Injectable()
export class BrevoEmailService implements EmailService {
  private readonly brevo: BrevoClient;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(configService: ConfigService) {
    this.brevo = new BrevoClient({
      apiKey: configService.getOrThrow<string>('BREVO_API_KEY'),
    });
    this.fromAddress = configService.getOrThrow<string>('EMAIL_FROM_ADDRESS');
    this.fromName = configService.getOrThrow<string>('EMAIL_FROM_NAME');
  }

  async send(message: EmailMessage): Promise<void> {
    await this.brevo.transactionalEmails.sendTransacEmail({
      subject: message.subject,
      textContent: message.body,
      sender: { name: this.fromName, email: this.fromAddress },
      to: [{ email: message.to }],
    });
  }
}
