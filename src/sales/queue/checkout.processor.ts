import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CHECKOUT_QUEUE, CheckoutJobName } from './checkout.constants';

@Processor(CHECKOUT_QUEUE)
export class CheckoutProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {
    super();
  }

  // BullMQ swallows a thrown error into the job's "failed" state silently unless something
  // listens for it — without this, a failed refund has no visible trace anywhere except the
  // "orders that owe a refund" monitoring query (architecture.md) eventually catching it.
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Checkout job ${job.id} (${job.name}) failed: ${error.message}`,
      error.stack,
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name as CheckoutJobName) {
      case CheckoutJobName.RefundPayment: {
        const { paymentId, stripeReferenceId } = job.data as {
          paymentId: string;
          stripeReferenceId: string;
        };
        await this.stripeService.refundPayment(stripeReferenceId);
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { refundedAt: new Date() },
        });
        return;
      }
      default:
        throw new Error(`Unknown checkout job: ${job.name}`);
    }
  }
}
