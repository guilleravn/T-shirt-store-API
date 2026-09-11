import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailQueueService } from './email-queue.service';
import { EMAIL_QUEUE, EmailJobName } from './email.constants';

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        { provide: getQueueToken(EMAIL_QUEUE), useValue: queue },
      ],
    }).compile();
    service = module.get(EmailQueueService);
  });

  it('enqueues the password-reset email with retry/backoff so a transient send failure is not silently dropped', async () => {
    await service.enqueuePasswordResetEmail({
      to: 'user@example.com',
      firstName: 'Guille',
      resetToken: 'raw-token',
    });

    expect(queue.add).toHaveBeenCalledWith(
      EmailJobName.PasswordReset,
      { to: 'user@example.com', firstName: 'Guille', resetToken: 'raw-token' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 50,
      }) as Record<string, unknown>,
    );
  });

  it('enqueues the password-changed email with the same retry/backoff', async () => {
    await service.enqueuePasswordChangedEmail({
      to: 'user@example.com',
      firstName: 'Guille',
    });

    expect(queue.add).toHaveBeenCalledWith(
      EmailJobName.PasswordChanged,
      { to: 'user@example.com', firstName: 'Guille' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }) as Record<string, unknown>,
    );
  });
});
