import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CheckoutService } from './checkout.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';

@Controller('checkout')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('payment-intent')
  @HttpCode(HttpStatus.CREATED)
  createPaymentIntent(
    @Body() dto: CreatePaymentIntentDto,
    @CurrentUser() user: User,
  ) {
    return this.checkoutService.createPaymentIntent(user, dto);
  }

  @Post('payment-link')
  @HttpCode(HttpStatus.CREATED)
  createPaymentLink(
    @Body() dto: CreatePaymentLinkDto,
    @CurrentUser() user: User,
  ) {
    return this.checkoutService.createPaymentLink(user, dto);
  }
}
