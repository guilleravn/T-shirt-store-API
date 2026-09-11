import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3ImageStorageService } from './s3-image-storage.service';

describe('S3ImageStorageService', () => {
  let service: S3ImageStorageService;
  let sendSpy: jest.SpyInstance;

  const config: Record<string, string> = {
    AWS_REGION: 'us-east-2',
    AWS_S3_BUCKET: 'tshirt-store-api-demo-images',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  };

  beforeEach(async () => {
    sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3ImageStorageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get(S3ImageStorageService);
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  describe('upload', () => {
    it('sends a PutObjectCommand with the given key, body, and content type', async () => {
      const body = Buffer.from('fake-image-bytes');
      await service.upload('products/p1/img1.jpg', body, 'image/jpeg');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const calls = sendSpy.mock.calls as [{ input: unknown }][];
      const command = calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'tshirt-store-api-demo-images',
        Key: 'products/p1/img1.jpg',
        Body: body,
        ContentType: 'image/jpeg',
      });
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand for the given key', async () => {
      await service.delete('products/p1/img1.jpg');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const calls = sendSpy.mock.calls as [{ input: unknown }][];
      const command = calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'tshirt-store-api-demo-images',
        Key: 'products/p1/img1.jpg',
      });
    });
  });

  describe('getPublicUrl', () => {
    it('builds a virtual-hosted-style S3 URL from the bucket, region, and key', () => {
      expect(service.getPublicUrl('products/p1/img1.jpg')).toBe(
        'https://tshirt-store-api-demo-images.s3.us-east-2.amazonaws.com/products/p1/img1.jpg',
      );
    });
  });
});
