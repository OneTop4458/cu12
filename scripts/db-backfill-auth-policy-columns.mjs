import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const POLICY_TEMPLATE_TOKENS = {
  companyName: "{{COMPANY_NAME}}",
  supportEmail: "{{SUPPORT_EMAIL}}",
  companyAddress: "{{COMPANY_ADDRESS}}",
  dpoName: "{{DPO_NAME}}",
  dpoTitle: "{{DPO_TITLE}}",
  dpoEmail: "{{DPO_EMAIL}}",
  dpoPhone: "{{DPO_PHONE}}",
  jurisdictionCourt: "{{JURISDICTION_COURT}}",
  effectiveDate: "{{EFFECTIVE_DATE}}",
  revisionDate: "{{REVISION_DATE}}",
};

function renderPolicyContent(template, profile) {
  let content = template;
  const replacements = [
    [POLICY_TEMPLATE_TOKENS.companyName, profile.companyName ?? ""],
    [POLICY_TEMPLATE_TOKENS.supportEmail, profile.supportEmail ?? ""],
    [POLICY_TEMPLATE_TOKENS.companyAddress, profile.companyAddress ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoName, profile.dpoName ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoTitle, profile.dpoTitle ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoEmail, profile.dpoEmail ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoPhone, profile.dpoPhone ?? ""],
    [POLICY_TEMPLATE_TOKENS.jurisdictionCourt, profile.jurisdictionCourt ?? ""],
    [POLICY_TEMPLATE_TOKENS.effectiveDate, profile.effectiveDate ?? ""],
    [POLICY_TEMPLATE_TOKENS.revisionDate, profile.revisionDate ?? ""],
  ];

  for (const [token, value] of replacements) {
    content = content.split(token).join(value);
  }

  return content;
}

function hasTemplateToken(value) {
  return typeof value === "string" && value.includes("{{");
}

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    `"${tableName}"`,
  );
  return rows[0]?.exists === true;
}

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS "exists"`,
    tableName,
    columnName,
  );
  return rows[0]?.exists === true;
}

if (!process.env.DATABASE_URL) {
  console.error("[db-sync] DATABASE_URL is required.");
  process.exit(1);
}

try {
  if (await tableExists("PolicyDocument")) {
    const hasContent = await columnExists("PolicyDocument", "content");
    const hasTemplate = await columnExists("PolicyDocument", "templateContent");
    const hasPublished = await columnExists("PolicyDocument", "publishedContent");

    if (hasContent && hasTemplate && hasPublished) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "PolicyDocument"
        SET "templateContent" = COALESCE("templateContent", "content"),
            "publishedContent" = COALESCE("publishedContent", "content", "templateContent")
        WHERE "templateContent" IS NULL
           OR "publishedContent" IS NULL
      `);
      console.log(`[db-sync] Backfilled policy snapshot columns for ${updated} rows.`);
    }

    if (hasContent && hasTemplate && hasPublished) {
      const profile = await prisma.policyProfile.findUnique({
        where: { id: "default" },
        select: {
          companyName: true,
          supportEmail: true,
          companyAddress: true,
          dpoName: true,
          dpoTitle: true,
          dpoEmail: true,
          dpoPhone: true,
          jurisdictionCourt: true,
          effectiveDate: true,
          revisionDate: true,
        },
      });

      if (profile) {
        const rows = await prisma.policyDocument.findMany({
          where: {
            OR: [
              { content: { contains: "{{" } },
              { publishedContent: { contains: "{{" } },
            ],
          },
          select: {
            id: true,
            content: true,
            templateContent: true,
            publishedContent: true,
          },
        });

        let fixedCount = 0;
        for (const row of rows) {
          const template = row.templateContent ?? row.content ?? row.publishedContent ?? "";
          if (!hasTemplateToken(template) && !hasTemplateToken(row.publishedContent) && !hasTemplateToken(row.content)) {
            continue;
          }

          const rendered = renderPolicyContent(template, profile);
          if (rendered === row.publishedContent && rendered === row.content) {
            continue;
          }

          await prisma.policyDocument.update({
            where: { id: row.id },
            data: {
              content: rendered,
              publishedContent: rendered,
              templateContent: template,
            },
          });
          fixedCount += 1;
        }

        console.log(`[db-sync] Re-rendered ${fixedCount} policy snapshot rows that still contained template tokens.`);
      }
    }
  }

  if (await tableExists("Cu12Account")) {
    const hasProvider = await columnExists("Cu12Account", "provider");
    const hasAccountStatus = await columnExists("Cu12Account", "accountStatus");

    if (hasProvider) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "Cu12Account"
        SET "provider" = 'CU12'::"PortalProvider"
        WHERE "provider" IS NULL
      `);
      console.log(`[db-sync] Backfilled provider on ${updated} Cu12Account rows.`);
    }

    if (hasAccountStatus) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "Cu12Account"
        SET "accountStatus" = 'CONNECTED'::"AccountStatus"
        WHERE "accountStatus" IS NULL
      `);
      console.log(`[db-sync] Backfilled accountStatus on ${updated} Cu12Account rows.`);
    }
  }

  if (await tableExists("MailSubscription")) {
    const hasAlertOnNotice = await columnExists("MailSubscription", "alertOnNotice");
    const hasDigestEnabled = await columnExists("MailSubscription", "digestEnabled");

    if (hasAlertOnNotice && hasDigestEnabled) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "MailSubscription"
        SET "alertOnNotice" = false,
            "digestEnabled" = false
        WHERE "alertOnNotice" = true
           OR "digestEnabled" = true
      `);
      console.log(`[db-sync] Quieted noisy mail preferences for ${updated} MailSubscription rows.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
