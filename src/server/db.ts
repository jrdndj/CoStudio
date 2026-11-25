import { PrismaClient } from "@prisma/client";

const globalDb = globalThis as unknown as { coStudioDb?: PrismaClient };

export const db = globalDb.coStudioDb ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalDb.coStudioDb = db;
