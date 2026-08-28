import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
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
