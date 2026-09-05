import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CHECKOUT_QUEUE } from './queue/checkout.constants';
import { CheckoutProcessor } from './queue/checkout.processor';
import { CheckoutQueueService } from './queue/checkout-queue.service';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [BullModule.registerQueue({ name: CHECKOUT_QUEUE })],
  controllers: [OrdersController, CheckoutController, StripeWebhookController],
  providers: [
    OrdersService,
    OrderAbilityFactory,
    StripeService,
    CheckoutService,
    StripeWebhookService,
    CheckoutQueueService,
    CheckoutProcessor,
  ],
})
export class SalesModule {}
