import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

// No guards, no @Body() DTO — openapi.yaml declares this route `security: []`, and Stripe's
// signature is the only authentication it needs. A DTO here would collide with the global
// ValidationPipe's forbidNonWhitelisted against Stripe's arbitrary nested JSON, and req.rawBody
// (not the parsed req.body) is what signature verification actually needs — see main.ts's
// `rawBody: true`.
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly stripeWebhookService: StripeWebhookService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: true }> {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }
    await this.stripeWebhookService.handleEvent(req.rawBody, signature);
    return { received: true };
  }
}
