import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { generateToken } from "@/lib/token";
import { upsertCu12Account } from "@/server/cu12-account";
import { isCu12UnavailableResult, verifyCu12Login } from "@/server/cu12-login";
import { writeAuditLog } from "@/server/audit-log";

const CreateMemberSchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120).optional(),
  localPassword: z.string().min(8).max(120).optional(),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
  isTestUser: z.boolean().default(false),
  isActive: z.boolean().default(true),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Math.max(limitRaw, 1), 500);

  const members = await prisma.user.findMany({
    where: {
      withdrawnAt: null,
      ...(q
        ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      isTestUser: true,
      createdAt: true,
      updatedAt: true,
      cu12Account: {
        select: {
          cu12Id: true,
          campus: true,
          accountStatus: true,
          statusReason: true,
          autoLearnEnabled: true,
          quizAutoSolveEnabled: true,
          detectActivitiesEnabled: true,
          emailDigestEnabled: true,
          updatedAt: true,
        },
      },
      mailSubs: {
        take: 1,
        select: {
          email: true,
          enabled: true,
          alertOnNotice: true,
          alertOnDeadline: true,
          alertOnAutolearn: true,
          digestEnabled: true,
          digestHour: true,
          updatedAt: true,
        },
      },
    },
  });

  return jsonOk({
    members: members.map((member) => {
      const { mailSubs, ...rest } = member;
      return {
        ...rest,
        mailPreference: mailSubs[0] ?? null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, CreateMemberSchema);
    const localPassword = body.localPassword?.trim();
    const campus = body.campus ?? "SONGSIM";
    const role = body.role ?? "USER";
    const isActive = body.isActive ?? true;
    const isTestUser = body.isTestUser ?? false;

    if (isTestUser && !localPassword) {
      return jsonError("localPassword is required for test users", 400, "VALIDATION_ERROR");
    }
    if (!isTestUser && !body.cu12Password) {
      return jsonError("cu12Password is required for CU12 users", 400, "VALIDATION_ERROR");
    }

    if (!isTestUser) {
      const validation = await verifyCu12Login({
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password ?? "",
        campus,
      });
      if (!validation.ok) {
        const unavailable = isCu12UnavailableResult(validation);
        await writeAuditLog({
          category: "AUTH",
          severity: unavailable ? "ERROR" : "WARN",
          actorUserId: context.actor.userId,
          message: unavailable
            ? "Admin member create failed due to CU12 service unavailability"
            : "Admin member create failed due to CU12 verification",
          meta: {
            cu12Id: body.cu12Id,
            campus,
            messageCode: validation.messageCode ?? null,
          },
        });
        if (unavailable) {
          return jsonError("CU12 authentication service unavailable.", 503, "CU12_UNAVAILABLE");
        }
        return jsonError("CU12 ID or password is invalid.", 401, "CU12_AUTH_FAILED");
      }
    }

    const existingAccount = await prisma.cu12Account.findUnique({
      where: { cu12Id: body.cu12Id },
      select: { userId: true },
    });
    const existingUser = await prisma.user.findUnique({
      where: { email: body.cu12Id },
      select: { id: true },
    });

    let userId = existingAccount?.userId ?? existingUser?.id ?? null;
    let created = false;

    if (!userId) {
      const passwordHash = isTestUser
        ? await hashPassword(localPassword!)
        : await hashPassword(generateToken(16));
      const createdUser = await prisma.user.create({
        data: {
          email: body.cu12Id,
          name: body.name ?? body.cu12Id,
          passwordHash,
          role,
          isTestUser,
          isActive,
        },
        select: { id: true },
      });
      userId = createdUser.id;
      created = true;
    } else {
      const updateData: {
        role: "ADMIN" | "USER";
        isTestUser: boolean;
        isActive: boolean;
        name: string | undefined;
        email: string;
        passwordHash?: string;
      } = {
        role,
        isTestUser,
        isActive,
        name: body.name ?? undefined,
        email: body.cu12Id,
      };

      if (isTestUser && localPassword) {
        updateData.passwordHash = await hashPassword(localPassword!);
      }

      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    if (!isTestUser) {
      await upsertCu12Account(userId, {
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password ?? "",
        campus,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isTestUser: true,
        isActive: true,
        createdAt: true,
        cu12Account: {
          select: {
            cu12Id: true,
            campus: true,
            accountStatus: true,
            statusReason: true,
            quizAutoSolveEnabled: true,
          },
        },
      },
    });

    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: created ? "Admin created member" : "Admin updated member",
      meta: {
        cu12Id: body.cu12Id,
        campus,
        role,
        isTestUser,
        isActive,
      },
    });

    return jsonOk({ created, user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to create member", 500);
  }
}
