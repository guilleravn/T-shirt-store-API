import { Module } from '@nestjs/common';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  controllers: [OrdersController, CheckoutController, StripeWebhookController],
  providers: [
    OrdersService,
    OrderAbilityFactory,
    StripeService,
    CheckoutService,
    StripeWebhookService,
  ],
})
export class SalesModule {}
