import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CHECKOUT_QUEUE, CheckoutJobName } from './checkout.constants';

interface RefundPaymentJobData {
  paymentId: string;
  stripeReferenceId: string;
}

// The only thing OrdersService talks to — never the raw queue, never StripeService directly.
@Injectable()
export class CheckoutQueueService {
  constructor(
    @InjectQueue(CHECKOUT_QUEUE) private readonly checkoutQueue: Queue,
  ) {}

  async enqueueRefund(data: RefundPaymentJobData): Promise<void> {
    // Unlike the email jobs (no retry config at all — a missed notification is not a loose
    // end), an unrefunded successful payment is a real financial liability, so this keeps
    // retrying with backoff instead of giving up after one failure.
    await this.checkoutQueue.add(CheckoutJobName.RefundPayment, data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
