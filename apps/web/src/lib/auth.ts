import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getEnv } from "./env";

export const SESSION_COOKIE_NAME = "cu12_session";

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: "ADMIN" | "USER";
}

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_JWT_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signSessionToken(payload: SessionTokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(jwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    const value = verified.payload as Partial<SessionTokenPayload>;
    if (!value.userId || !value.email || !value.role) {
      return null;
    }
    return {
      userId: value.userId,
      email: value.email,
      role: value.role,
    };
  } catch {
    return null;
  }
}
