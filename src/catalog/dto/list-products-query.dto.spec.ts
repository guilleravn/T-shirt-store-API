import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListProductsQueryDto } from './list-products-query.dto';

// Regression test for `@Type(() => Boolean)`'s footgun: `Boolean('false')` is `true` in JS, so
// the old decorator silently turned `?includeInactive=false` into `true`. class-validator's
// `validate()` runs the real `@IsBoolean()`/`@Transform()` pipeline Nest's ValidationPipe uses.
describe('ListProductsQueryDto', () => {
  it('parses ?includeInactive=false as false, not true', async () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      includeInactive: 'false',
    });

    expect(dto.includeInactive).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('parses ?includeInactive=true as true', async () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      includeInactive: 'true',
    });

    expect(dto.includeInactive).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-boolean value instead of silently coercing it', async () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      includeInactive: 'yes',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('includeInactive');
  });
});
