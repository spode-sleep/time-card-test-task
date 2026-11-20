import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { database } from './database.js';

export const prisma = new PrismaClient({
  adapter: new PrismaPg(database),
});
