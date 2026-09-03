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
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { ListPromoCodesQueryDto } from './dto/list-promo-codes-query.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { ValidatePromoCodeDto } from './dto/validate-promo-code.dto';
import { PromoCodesService } from './promo-codes.service';

@Controller('promo-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromoCodesController {
  constructor(private readonly promoCodesService: PromoCodesService) {}

  @Get()
  @Roles(UserRole.MANAGER)
  list(@Query() query: ListPromoCodesQueryDto) {
    return this.promoCodesService.list(query);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePromoCodeDto) {
    return this.promoCodesService.create(dto);
  }

  @Patch(':promoCodeId')
  @Roles(UserRole.MANAGER)
  update(
    @Param('promoCodeId', ParseUUIDPipe) promoCodeId: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.promoCodesService.update(promoCodeId, dto);
  }

  @Post(':promoCodeId/disable')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  disable(@Param('promoCodeId', ParseUUIDPipe) promoCodeId: string) {
    return this.promoCodesService.setActive(promoCodeId, false);
  }

  @Post(':promoCodeId/enable')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  enable(@Param('promoCodeId', ParseUUIDPipe) promoCodeId: string) {
    return this.promoCodesService.setActive(promoCodeId, true);
  }

  @Post('validate')
  @Roles(UserRole.CLIENT)
  @HttpCode(HttpStatus.OK)
  validate(@Body() dto: ValidatePromoCodeDto) {
    return this.promoCodesService.validate(dto);
  }
}
