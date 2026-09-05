import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListVariantsQueryDto } from './list-variants-query.dto';

// Regression test for `@Type(() => Boolean)`'s footgun: `Boolean('false')` is `true` in JS, so
// the old decorator silently turned `?includeInactive=false`/`?lowStock=false` into `true`.
describe('ListVariantsQueryDto', () => {
  it('parses ?includeInactive=false as false, not true', async () => {
    const dto = plainToInstance(ListVariantsQueryDto, {
      includeInactive: 'false',
    });

    expect(dto.includeInactive).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('parses ?lowStock=false as false, not true', async () => {
    const dto = plainToInstance(ListVariantsQueryDto, { lowStock: 'false' });

    expect(dto.lowStock).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('parses ?lowStock=true as true', async () => {
    const dto = plainToInstance(ListVariantsQueryDto, { lowStock: 'true' });

    expect(dto.lowStock).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-boolean lowStock value instead of silently coercing it', async () => {
    const dto = plainToInstance(ListVariantsQueryDto, { lowStock: 'yes' });

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('lowStock');
  });
});
