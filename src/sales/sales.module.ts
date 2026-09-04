import { Module } from '@nestjs/common';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrderAbilityFactory],
})
export class SalesModule {}
