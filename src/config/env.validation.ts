import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().positive().default(30),
  BREVO_API_KEY: Joi.string().required(),
  EMAIL_FROM_ADDRESS: Joi.string().email({ tlds: false }).required(),
  EMAIL_FROM_NAME: Joi.string().default('T-Shirt Store'),
  AWS_REGION: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
});
