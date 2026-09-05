import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';
import { CheckoutProcessor } from './checkout.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CheckoutJobName } from './checkout.constants';

function buildJob(name: string, data: Record<string, unknown>): Job {
  return { id: 'job-1', name, data } as unknown as Job;
}

describe('CheckoutProcessor', () => {
  let processor: CheckoutProcessor;
  let prisma: { payment: { update: jest.Mock } };
  let stripeService: { refundPayment: jest.Mock };

  beforeEach(async () => {
    prisma = { payment: { update: jest.fn() } };
    stripeService = { refundPayment: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CheckoutProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripeService },
      ],
    }).compile();

    processor = module.get(CheckoutProcessor);
  });

  it('refunds the payment via Stripe with paymentId as the idempotency key, then marks refundedAt once Stripe confirms it succeeded', async () => {
    stripeService.refundPayment.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
    });

    await processor.process(
      buildJob(CheckoutJobName.RefundPayment, {
        paymentId: 'pay-1',
        stripeReferenceId: 'pi_1',
      }),
    );

    expect(stripeService.refundPayment).toHaveBeenCalledWith('pi_1', 'pay-1');
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { refundedAt: expect.any(Date) as Date },
    });
  });

  it('does not mark refundedAt when the refund is not yet succeeded (e.g. pending)', async () => {
    stripeService.refundPayment.mockResolvedValue({
      id: 're_1',
      status: 'pending',
    });

    await processor.process(
      buildJob(CheckoutJobName.RefundPayment, {
        paymentId: 'pay-1',
        stripeReferenceId: 'pi_1',
      }),
    );

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('throws on an unknown job name instead of silently succeeding', async () => {
    await expect(
      processor.process(buildJob('unknown-job', {})),
    ).rejects.toThrow('Unknown checkout job: unknown-job');
  });
});
