import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectAssets } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await db.select().from(projectAssets).where(eq(projectAssets.id, id)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Asset not found" }, { status: 404 });

  const bytes = Buffer.from(row.dataBase64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": row.mime,
      "content-length": String(bytes.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
