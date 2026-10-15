import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const agents = await prisma.agent.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      description: true,
      framework: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(agents);
}