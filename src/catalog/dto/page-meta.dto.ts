export class PageMetaDto {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;

  constructor(params: { total: number; limit: number; offset: number }) {
    this.total = params.total;
    this.limit = params.limit;
    this.offset = params.offset;
    this.hasMore = params.offset + params.limit < params.total;
  }
}
