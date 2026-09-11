import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

// openapi.yaml's OrderId param declares format: uuid, and every other :id route in this repo
// (cart, product variants, product images, promo codes) enforces that at the edge with
// ParseUUIDPipe rather than letting a malformed id reach the service as a raw Prisma error.
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(UserRole.CLIENT, UserRole.MANAGER, UserRole.DELIVERY)
  list(@Query() query: ListOrdersQueryDto, @CurrentUser() user: User) {
    return this.ordersService.list(user, query);
  }

  @Post()
  @Roles(UserRole.CLIENT)
  @HttpCode(HttpStatus.CREATED)
  // Idempotency-Key (openapi.yaml) is accepted — an unrecognized header is never rejected — but
  // not stored or replayed in this branch (see the plan's "Idempotency-Key" decision): the
  // existing one-PENDING-order-per-user conflict is what actually stops a double submit today.
  async create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const order = await this.ordersService.create(user, dto);
    res.setHeader('Location', `/v1/orders/${order.id}`);
    return order;
  }

  @Get(':orderId')
  @Roles(UserRole.CLIENT, UserRole.MANAGER, UserRole.DELIVERY)
  detail(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.detail(orderId, user);
  }

  @Patch(':orderId/status')
  @Roles(UserRole.MANAGER, UserRole.DELIVERY)
  updateStatus(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.updateStatus(orderId, user, dto);
  }

  @Post(':orderId/cancel')
  @Roles(UserRole.CLIENT, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.cancel(orderId, user, dto);
  }
}
