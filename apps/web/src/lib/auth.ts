import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getEnv } from "./env";

export const SESSION_COOKIE_NAME = "cu12_session";
export const IMPERSONATION_COOKIE_NAME = "cu12_impersonation";
const LOGIN_CHALLENGE_PURPOSE = "INVITE_LOGIN_CHALLENGE";
const IMPERSONATION_PURPOSE = "ADMIN_IMPERSONATION";

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: "ADMIN" | "USER";
}

export interface LoginChallengePayload {
  purpose: typeof LOGIN_CHALLENGE_PURPOSE;
  cu12Id: string;
  campus: "SONGSIM" | "SONGSIN";
  encryptedCu12Password: string;
  nonce: string;
}

export interface ImpersonationPayload {
  purpose: typeof IMPERSONATION_PURPOSE;
  actorUserId: string;
  targetUserId: string;
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

export async function signLoginChallengeToken(payload: Omit<LoginChallengePayload, "purpose">): Promise<string> {
  return new SignJWT({
    purpose: LOGIN_CHALLENGE_PURPOSE,
    cu12Id: payload.cu12Id,
    campus: payload.campus,
    encryptedCu12Password: payload.encryptedCu12Password,
    nonce: payload.nonce,
  } satisfies LoginChallengePayload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(jwtSecret());
}

export async function verifyLoginChallengeToken(token: string): Promise<LoginChallengePayload | null> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    const value = verified.payload as Partial<LoginChallengePayload>;
    if (
      value.purpose !== LOGIN_CHALLENGE_PURPOSE ||
      !value.cu12Id ||
      !value.campus ||
      !value.encryptedCu12Password ||
      !value.nonce
    ) {
      return null;
    }

    if (value.campus !== "SONGSIM" && value.campus !== "SONGSIN") {
      return null;
    }

    return {
      purpose: LOGIN_CHALLENGE_PURPOSE,
      cu12Id: value.cu12Id,
      campus: value.campus,
      encryptedCu12Password: value.encryptedCu12Password,
      nonce: value.nonce,
    };
  } catch {
    return null;
  }
}

export async function signImpersonationToken(payload: Omit<ImpersonationPayload, "purpose">): Promise<string> {
  return new SignJWT({
    purpose: IMPERSONATION_PURPOSE,
    actorUserId: payload.actorUserId,
    targetUserId: payload.targetUserId,
  } satisfies ImpersonationPayload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("6h")
    .sign(jwtSecret());
}

export async function verifyImpersonationToken(token: string): Promise<ImpersonationPayload | null> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    const value = verified.payload as Partial<ImpersonationPayload>;
    if (value.purpose !== IMPERSONATION_PURPOSE || !value.actorUserId || !value.targetUserId) {
      return null;
    }

    return {
      purpose: IMPERSONATION_PURPOSE,
      actorUserId: value.actorUserId,
      targetUserId: value.targetUserId,
    };
  } catch {
    return null;
  }
}

