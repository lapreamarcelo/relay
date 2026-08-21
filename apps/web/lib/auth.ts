import "server-only";

import { hash, verify } from "@node-rs/argon2";
import { db, schema, sql } from "@relay/database";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { assertRegistrationAllowed, RegistrationPolicyError } from "./registration-policy";

const appUrl = process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";

async function numberOfUsers(): Promise<number> {
  const [result] = await sql<{ value: number }[]>`SELECT count(*)::int AS value FROM "user"`;
  return result?.value ?? 0;
}

export const auth = betterAuth({
  appName: "Relay",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [new URL(appUrl).origin],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    password: {
      hash: (password) =>
        hash(password, {
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
      verify: ({ hash: passwordHash, password }) => verify(passwordHash, password),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "MEMBER",
        input: false,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-up/email") return;

      try {
        assertRegistrationAllowed({
          registrationEnabled: process.env.ALLOW_REGISTRATION === "true",
          userCount: await numberOfUsers(),
          configuredSetupToken: process.env.RELAY_SETUP_TOKEN,
          providedSetupToken: context.headers?.get("x-relay-setup-token") ?? undefined,
        });
      } catch (error) {
        if (error instanceof RegistrationPolicyError) {
          throw new APIError("FORBIDDEN", { message: error.message });
        }
        throw error;
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => ({
          data: {
            ...newUser,
            role: (await numberOfUsers()) === 0 ? "OWNER" : "MEMBER",
          },
        }),
      },
    },
  },
  advanced: {
    cookiePrefix: "relay",
    useSecureCookies: appUrl.startsWith("https://"),
  },
});

export async function getRegistrationStatus() {
  const users = await numberOfUsers();
  return {
    allowed: process.env.ALLOW_REGISTRATION === "true",
    requiresSetupToken: users === 0,
    hasUsers: users > 0,
  };
}
