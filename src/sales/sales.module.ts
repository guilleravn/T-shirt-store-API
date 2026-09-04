import { Module } from '@nestjs/common';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StripeService } from './stripe/stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderAbilityFactory,
    StripeService,
    StripeWebhookService,
  ],
})
export class SalesModule {}
