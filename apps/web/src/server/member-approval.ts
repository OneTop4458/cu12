import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidateCachedAuthState } from "@/server/auth-state-cache";

export async function getMemberApprovalRequired(): Promise<boolean> {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { memberApprovalRequired: true },
    });
    return settings?.memberApprovalRequired ?? true;
  } catch (error) {
    // Keep approval enabled during rollout until DB Bootstrap creates the table.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return true;
    }
    throw error;
  }
}

interface ApprovalUser {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  withdrawnAt: Date | null;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
}

// Only call after successful real-time portal authentication.
export async function autoApprovePendingUserOnLogin(user: ApprovalUser): Promise<ApprovalUser> {
  if (user.approvalStatus !== "PENDING" || user.withdrawnAt !== null || await getMemberApprovalRequired()) {
    return user;
  }

  await prisma.user.updateMany({
    where: { id: user.id, approvalStatus: "PENDING", withdrawnAt: null },
    data: {
      approvalStatus: "APPROVED",
      isActive: true,
      approvalDecidedAt: new Date(),
      approvalDecidedByUserId: null,
      approvalRejectedReason: null,
    },
  });
  invalidateCachedAuthState(user.id);
  // Re-read so a concurrent rejection or withdrawal cannot be bypassed.
  return prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { id: true, email: true, role: true, isActive: true, withdrawnAt: true, approvalStatus: true },
  });
}
