"use server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireAdmin } from "@/server/access";
import { hashPassword } from "@/lib/password";

// Shop-/Shopify-/Postfach-Verwaltung liegt in actions/shops.ts (saveShop, setShopActive).

export async function createUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "agent");
  const password = String(formData.get("password") ?? "");
  const shopIds = formData.getAll("shopIds").map(String);
  if (!email || !password) throw new Error("E-Mail und Passwort nötig");
  if (role !== "agent" && role !== "admin") throw new Error("Ungültige Rolle");

  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({ email, name, role: role as "agent" | "admin", passwordHash: hashPassword(password) })
      .returning({ id: schema.users.id });
    for (const shopId of shopIds) {
      await tx.insert(schema.userShops).values({ userId: u.id, shopId });
    }
  });
  revalidatePath("/admin");
}
