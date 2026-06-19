// Erst-Admin anlegen / zum Admin machen.
//   npm run seed:admin -- <email> <passwort> ["Name"]
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { hashPassword } from "../src/lib/password";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Aufruf: npm run seed:admin -- <email> <passwort> ["Name"]');
    process.exit(1);
  }
  const lower = email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, lower),
  });
  if (existing) {
    await db
      .update(schema.users)
      .set({ role: "admin", active: true, passwordHash: hashPassword(password) })
      .where(eq(schema.users.id, existing.id));
    console.log(`Bestehender Nutzer ${lower} ist jetzt Admin (Passwort gesetzt).`);
  } else {
    await db.insert(schema.users).values({
      email: lower,
      name: name ?? "Admin",
      role: "admin",
      passwordHash: hashPassword(password),
    });
    console.log(`Admin ${lower} angelegt.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
