import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';

@Module({
  imports: [PrismaModule],
  controllers: [PromoCodesController],
  providers: [PromoCodesService],
})
export class PromoModule {}
