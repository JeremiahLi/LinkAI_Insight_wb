import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const skills = await prisma.skill.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(skills);
}
