import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  const skill = await prisma.skill.findUnique({
    where: { name: decodedName },
  });

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  return NextResponse.json(skill);
}
