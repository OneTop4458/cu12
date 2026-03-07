import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  IDLE_SESSION_COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionTokenPayload,
  verifyActiveSession,
  verifyImpersonationToken,
} from "./auth";
import { getEnv } from "./env";
import { prisma } from "./prisma";

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function jsonCreated<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 201, ...init });
}

export function jsonError(message: string, status = 400, errorCode?: string): NextResponse {
  return NextResponse.json(
    errorCode ? { error: message, errorCode } : { error: message },
    { status },
  );
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

function firstForwardedFor(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0];
  return normalizeIp(first);
}

export function getRequestIp(request: NextRequest): string | null {
  const requestWithIp = request as NextRequest & { ip?: string };
  const directIp = normalizeIp(requestWithIp.ip);
  if (directIp) return directIp;

  const trustProxyHeaders = getEnv().TRUST_PROXY_HEADERS || process.env.VERCEL === "1";
  if (!trustProxyHeaders) {
    return null;
  }

  const realIp = normalizeIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const cloudflareIp = normalizeIp(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;

  const flyIp = normalizeIp(request.headers.get("fly-client-ip"));
  if (flyIp) return flyIp;

  const forwardedFor = firstForwardedFor(request.headers.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor;

  return null;
}

function isMutationMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE";
}

function resolveRequestOrigin(request: NextRequest): { protocol: string; host: string } | null {
  const host = (
    request.headers.get("x-forwarded-host")
    ?? request.headers.get("host")
    ?? ""
  ).trim().toLowerCase();

  const protocol = (
    request.headers.get("x-forwarded-proto")
    ?? new URL(request.url).protocol.replace(":", "")
  ).trim().toLowerCase();

  if (!host || !protocol) return null;
  return { protocol, host };
}

function isHeaderOriginAllowed(value: string | null, expected: { protocol: string; host: string }): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol.replace(":", "").toLowerCase() === expected.protocol
      && parsed.host.toLowerCase() === expected.host;
  } catch {
    return false;
  }
}

export function hasValidCsrfOrigin(request: NextRequest): boolean {
  if (!isMutationMethod(request.method)) return true;

  const expected = resolveRequestOrigin(request);
  if (!expected) return process.env.NODE_ENV !== "production";

  const origin = request.headers.get("origin");
  if (origin) {
    return isHeaderOriginAllowed(origin, expected);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return isHeaderOriginAllowed(referer, expected);
  }

  return process.env.NODE_ENV !== "production";
}

export async function parseBody<T>(request: NextRequest, schema: z.ZodSchema<T>): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}

export async function requireUser(request: NextRequest): Promise<SessionTokenPayload | null> {
  if (!hasValidCsrfOrigin(request)) return null;

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const idleToken = request.cookies.get(IDLE_SESSION_COOKIE_NAME)?.value;
  const session = await verifyActiveSession(sessionToken, idleToken);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return {
    userId: session.userId,
    email: user.email,
    role: user.role,
  };
}

export interface RequestAuthContext {
  actor: SessionTokenPayload;
  effective: SessionTokenPayload;
  impersonating: boolean;
}

export async function requireAuthContext(request: NextRequest): Promise<RequestAuthContext | null> {
  const actor = await requireUser(request);
  if (!actor) return null;

  const impersonationToken = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
  if (!impersonationToken) {
    return {
      actor,
      effective: actor,
      impersonating: false,
    };
  }

  const payload = await verifyImpersonationToken(impersonationToken);
  if (!payload) {
    return {
      actor,
      effective: actor,
      impersonating: false,
    };
  }

  if (actor.role !== "ADMIN" || payload.actorUserId !== actor.userId) {
    return {
      actor,
      effective: actor,
      impersonating: false,
    };
  }

  const target = await prisma.user.findUnique({
    where: { id: payload.targetUserId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!target || !target.isActive) {
    return {
      actor,
      effective: actor,
      impersonating: false,
    };
  }

  return {
    actor,
    effective: {
      userId: target.id,
      email: target.email,
      role: target.role,
    },
    impersonating: true,
  };
}

export async function requireAdminActor(request: NextRequest): Promise<RequestAuthContext | null> {
  const context = await requireAuthContext(request);
  if (!context || context.actor.role !== "ADMIN") {
    return null;
  }
  return context;
}


