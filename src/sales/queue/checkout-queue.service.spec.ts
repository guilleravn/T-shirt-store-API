import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { CheckoutQueueService } from './checkout-queue.service';
import { CHECKOUT_QUEUE, CheckoutJobName } from './checkout.constants';

describe('CheckoutQueueService', () => {
  let service: CheckoutQueueService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        CheckoutQueueService,
        { provide: getQueueToken(CHECKOUT_QUEUE), useValue: queue },
      ],
    }).compile();
    service = module.get(CheckoutQueueService);
  });

  it('enqueues a refund job with retry backoff, unlike the fire-and-forget email jobs', async () => {
    await service.enqueueRefund({
      paymentId: 'pay-1',
      stripeReferenceId: 'pi_1',
    });

    expect(queue.add).toHaveBeenCalledWith(
      CheckoutJobName.RefundPayment,
      { paymentId: 'pay-1', stripeReferenceId: 'pi_1' },
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });
});
