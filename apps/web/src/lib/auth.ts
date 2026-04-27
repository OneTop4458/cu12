import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getEnv } from "./env";

export const SESSION_COOKIE_NAME = "cu12_session";
export const IMPERSONATION_COOKIE_NAME = "cu12_impersonation";
export const IDLE_SESSION_COOKIE_NAME = "cu12_idle";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const REMEMBER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const IDLE_SESSION_MAX_AGE_SECONDS = 60 * 30;
const POLICY_CONSENT_CHALLENGE_PURPOSE = "POLICY_CONSENT_CHALLENGE";
const IMPERSONATION_PURPOSE = "ADMIN_IMPERSONATION";
const IDLE_SESSION_PURPOSE = "IDLE_SESSION";

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: "ADMIN" | "USER";
}

export interface ImpersonationPayload {
  purpose: typeof IMPERSONATION_PURPOSE;
  actorUserId: string;
  targetUserId: string;
}

export interface PolicyConsentChallengePayload {
  purpose: typeof POLICY_CONSENT_CHALLENGE_PURPOSE;
  userId: string;
  email: string;
  role: "ADMIN" | "USER";
  rememberSession: boolean;
  firstLogin: boolean;
}

export interface IdleSessionPayload {
  purpose: typeof IDLE_SESSION_PURPOSE;
  userId: string;
  rememberSession: boolean;
}

export interface SessionLifetimePolicy {
  rememberSession: boolean;
  sessionMaxAgeSeconds: number;
  idleSessionMaxAgeSeconds: number;
}

export function resolveSessionLifetimePolicy(rememberSession: boolean | null | undefined): SessionLifetimePolicy {
  const remember = Boolean(rememberSession);
  return {
    rememberSession: remember,
    sessionMaxAgeSeconds: remember ? REMEMBER_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS,
    idleSessionMaxAgeSeconds: IDLE_SESSION_MAX_AGE_SECONDS,
  };
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

export async function signSessionToken(
  payload: SessionTokenPayload,
  options?: { maxAgeSeconds?: number },
): Promise<string> {
  const maxAgeSeconds = Math.max(60, Math.trunc(options?.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS));
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
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

export async function signIdleSessionToken(
  userId: string,
  options?: {
    rememberSession?: boolean;
    maxAgeSeconds?: number;
  },
): Promise<string> {
  const rememberSession = Boolean(options?.rememberSession);
  const maxAgeSeconds = Math.max(60, Math.trunc(options?.maxAgeSeconds ?? IDLE_SESSION_MAX_AGE_SECONDS));
  return new SignJWT({
    purpose: IDLE_SESSION_PURPOSE,
    userId,
    rememberSession,
  } satisfies IdleSessionPayload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(jwtSecret());
}

export async function verifyIdleSessionToken(token: string): Promise<IdleSessionPayload | null> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    const value = verified.payload as Partial<IdleSessionPayload>;
    if (value.purpose !== IDLE_SESSION_PURPOSE || !value.userId) {
      return null;
    }

    return {
      purpose: IDLE_SESSION_PURPOSE,
      userId: value.userId,
      rememberSession: value.rememberSession === true,
    };
  } catch {
    return null;
  }
}

export async function verifyActiveSession(sessionToken?: string, idleToken?: string): Promise<SessionTokenPayload | null> {
  if (!sessionToken || !idleToken) return null;

  const [session, idle] = await Promise.all([
    verifySessionToken(sessionToken),
    verifyIdleSessionToken(idleToken),
  ]);

  if (!session || !idle) return null;
  if (idle.userId !== session.userId) return null;

  return session;
}

export async function signPolicyConsentChallengeToken(
  payload: Omit<PolicyConsentChallengePayload, "purpose">,
): Promise<string> {
  return new SignJWT({
    purpose: POLICY_CONSENT_CHALLENGE_PURPOSE,
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    rememberSession: payload.rememberSession,
    firstLogin: payload.firstLogin,
  } satisfies PolicyConsentChallengePayload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(jwtSecret());
}

export async function verifyPolicyConsentChallengeToken(
  token: string,
): Promise<PolicyConsentChallengePayload | null> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    const value = verified.payload as Partial<PolicyConsentChallengePayload>;
    if (
      value.purpose !== POLICY_CONSENT_CHALLENGE_PURPOSE
      || !value.userId
      || !value.email
      || !value.role
    ) {
      return null;
    }
    if (value.role !== "ADMIN" && value.role !== "USER") {
      return null;
    }

    return {
      purpose: POLICY_CONSENT_CHALLENGE_PURPOSE,
      userId: value.userId,
      email: value.email,
      role: value.role,
      rememberSession: value.rememberSession === true,
      firstLogin: value.firstLogin === true,
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

