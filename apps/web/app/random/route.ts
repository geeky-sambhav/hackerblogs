import { connection } from "next/server";
import { getCatalog } from "@/lib/catalog";

/** "Surprise me": a random piece, chosen per request. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const { pieces } = await getCatalog();
  if (pieces.length === 0) return Response.redirect(new URL("/", request.url), 307);
  const p = pieces[Math.floor(Math.random() * pieces.length)];
  return Response.redirect(new URL(`/read/${p?.slug ?? ""}`, request.url), 307);
}
