import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { ProductLikesController } from './product-likes.controller';
import { ProductLikesService } from './product-likes.service';

@Module({
  imports: [PrismaModule],
  controllers: [CartController, ProductLikesController],
  providers: [CartService, ProductLikesService],
})
export class EngagementModule {}
