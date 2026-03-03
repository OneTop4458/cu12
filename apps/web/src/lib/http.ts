import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  IMPERSONATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionTokenPayload,
  verifyImpersonationToken,
  verifySessionToken,
} from "./auth";
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

export async function parseBody<T>(request: NextRequest, schema: z.ZodSchema<T>): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}

export async function requireUser(request: NextRequest): Promise<SessionTokenPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
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
    },
  });

  if (!target) {
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


