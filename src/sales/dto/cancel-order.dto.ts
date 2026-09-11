import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  // Matches order_status_history.note's VARCHAR(255) — without this, an over-long reason
  // overflows the column as a raw, uncaught P2000 (cancel()'s transaction isn't wrapped in a
  // try/catch like create()'s is), the same class of bug already fixed twice on this branch.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
