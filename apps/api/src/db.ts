import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env'
import { Prisma, PrismaClient } from './generated/prisma/client'

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) })

/** Either the client or an open transaction. Functions that write take this so callers control the transaction. */
export type Db = PrismaClient | Prisma.TransactionClient
export type Tx = Prisma.TransactionClient

export { Prisma }
export const Decimal = Prisma.Decimal
export type Decimal = Prisma.Decimal
