import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProductLikesService } from './product-likes.service';

@Controller('products/:productId/like')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT)
export class ProductLikesController {
  constructor(private readonly productLikesService: ProductLikesService) {}

  @Put()
  like(
    @CurrentUser() user: User,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.productLikesService.like(user.id, productId);
  }

  @Delete()
  unlike(
    @CurrentUser() user: User,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.productLikesService.unlike(user.id, productId);
  }
}
