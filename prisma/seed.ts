import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Dev-only seeded MANAGER — signup always creates CLIENT (see business-invariants.md), so this
// is the only way to get a MANAGER account without hand-editing the DB.
const SEED_MANAGER_PASSWORD = 'Manager123!';

async function main() {
  const managerPasswordHash = await bcrypt.hash(SEED_MANAGER_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: 'guichi.maldo@gmail.com' },
    update: {},
    create: {
      email: 'guichi.maldo@gmail.com',
      passwordHash: managerPasswordHash,
      firstName: 'Guillermo',
      lastName: 'Maldonado',
      role: 'MANAGER',
    },
  });

  const categories = [
    { name: 'Basics', slug: 'basics' },
    { name: 'Graphic Tees', slug: 'graphic-tees' },
    { name: 'Long Sleeve', slug: 'long-sleeve' },
    { name: 'Limited Edition', slug: 'limited-edition' },
  ];
  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  const colors = [
    { name: 'Black', hexCode: '#000000' },
    { name: 'White', hexCode: '#FFFFFF' },
    { name: 'Navy', hexCode: '#1A1A2E' },
    { name: 'Heather Gray', hexCode: '#9B9B9B' },
    { name: 'Red', hexCode: '#D7263D' },
  ];
  for (const color of colors) {
    await prisma.color.upsert({
      where: { name: color.name },
      update: {},
      create: color,
    });
  }

  // Gapped positions per the DBML note — inserting an XS later slots in at position 5 without
  // renumbering S/M/L/XL.
  const sizes = [
    { name: 'S', position: 10 },
    { name: 'M', position: 20 },
    { name: 'L', position: 30 },
    { name: 'XL', position: 40 },
  ];
  for (const size of sizes) {
    await prisma.size.upsert({
      where: { name: size.name },
      update: {},
      create: size,
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
