import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { verifyPassword } from "@/lib/password";

/** Grobe Geräte-Angabe aus dem User-Agent, z. B. „Mac · Chrome“ (keine IP, kein Fingerprint). */
function deviceFromUa(ua: string): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Gerät";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true, // selbst gehostet (kein Vercel) -> Host vertrauen
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      authorize: async (creds, request) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        const user = await db.query.users.findFirst({
          where: eq(schema.users.email, email),
        });
        if (!user || !user.active) return null;
        if (!verifyPassword(password, user.passwordHash)) return null;

        // Login fürs Team-Protokoll (/admin/team) merken — Fehler hier dürfen den Login nie blockieren
        await db
          .insert(schema.userLogin)
          .values({ userId: user.id, device: deviceFromUa(request?.headers?.get?.("user-agent") ?? "") })
          .catch(() => null);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role as "owner" | "member",
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role as "owner" | "member";
        token.uid = user.id as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "owner" | "member";
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});
