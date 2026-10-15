import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function parseCategoryFromMd(md: string): string | null {
  const match = md.match(/^#\s+(?:分类|Category|类型)[：:]\s*(.+)$/m);
  if (match) return match[1].trim();
  return null;
}

export function parseDescriptionFromMd(md: string): string | null {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ") && lines[i].includes("功能描述")) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j].trim();
        if (line && !line.startsWith("#") && !line.startsWith("```")) {
          return line.length > 100 ? line.slice(0, 100) + "..." : line;
        }
      }
    }
  }
  return null;
}

export async function upsertSkillFromSpan(name: string, skillMd: string) {
  const contentHash = computeContentHash(skillMd);
  const existing = await prisma.skill.findUnique({ where: { name } });

  if (existing) {
    if (existing.contentHash === contentHash) {
      return existing;
    }
    return prisma.skill.update({
      where: { name },
      data: {
        skillMd,
        contentHash,
        description: parseDescriptionFromMd(skillMd) || existing.description,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
      },
    });
  }

  return prisma.skill.create({
    data: {
      name,
      skillMd,
      contentHash,
      description: parseDescriptionFromMd(skillMd) || "",
      version: 1,
      lastSyncedAt: new Date(),
    },
  });
}
