import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEGACY_V1_TEMPLATES = {
  PRIVACY_POLICY: `개인정보처리방침

{{COMPANY_NAME}}(이하 "운영자")는 {{COMPANY_NAME}} 서비스(이하 "서비스") 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」 등 관련 법령을 준수합니다.
본 방침은 서비스에서 어떤 개인정보를 수집·이용·보관·파기하는지 안내합니다.

시행일: {{EFFECTIVE_DATE}}
최종 개정일: {{REVISION_DATE}}

제1조(처리하는 개인정보 항목)
운영자는 다음 개인정보를 처리할 수 있습니다.

1. 회원 식별 및 인증 정보(필수)
- CU12 ID
- CU12 비밀번호(복호화 가능한 암호화 형태로 저장)
- 캠퍼스 정보(성심/성신)

2. 서비스 계정/권한 정보(필수)
- 서비스 사용자 식별자(userId)
- 계정 역할(ADMIN/USER)
- 초대코드 사용 이력(사용일시, 사용자 등)

3. 보안 및 필수 동의 이력(필수)
- 마지막 로그인 일시
- 마지막 로그인 IP
- 약관 동의 이력(약관 종류, 버전, 동의일시, 동의 IP)
- 인증 시도 제한을 위한 보안 관련 기록

4. 서비스 처리/운영 정보(필수)
- 강의/공지/학습/알림 동기화 결과
- 작업(Job) 처리 이력, 실패/오류 로그, 감사 로그

5. 알림 정보(선택)
- 메일 수신 주소
- 메일 알림/요약 발송 설정

제2조(개인정보의 처리 목적)
운영자는 다음 목적을 위해 개인정보를 처리합니다.
1. 본인 확인 및 로그인/세션 관리
2. 초대코드 기반 1회 가입 검증
3. CU12 계정 연동 및 자동화 기능 제공(동기화, 공지/학습 정보 반영)
4. 이메일 알림 및 요약 메일 발송
5. 서비스 안정성 확보, 이상행위 탐지, 장애 대응, 감사 추적
6. 법령 준수 및 분쟁 대응

제3조(개인정보의 처리 및 보유기간)
운영자는 원칙적으로 목적 달성 시 지체 없이 파기합니다. 다만 아래 기준으로 보관할 수 있습니다.

1. 회원 계정/연동 정보
- 보유기간: 회원 탈퇴 시까지

2. 마지막 로그인 일시/IP
- 보유기간: 수집일로부터 최대 1년 또는 탈퇴 시 중 먼저 도래한 시점

3. 약관 동의 이력(동의 버전/일시/IP)
- 보유기간: 동의 철회 또는 회원 탈퇴 후 3년까지(분쟁 대응 목적)

4. 운영 로그 일부
- 감사 로그(AuditLog): 생성일로부터 30일
- 작업 이력(JobQueue, 종료 상태): 생성일로부터 14일
- 메일 발송 이력(MailDelivery): 생성일로부터 30일

5. 관계 법령에 따라 보존이 필요한 경우
- 해당 법령에서 정한 기간 동안 별도 보관

제4조(개인정보의 수집 방법)
운영자는 다음 방법으로 개인정보를 수집합니다.
1. 이용자가 로그인/설정 화면에 직접 입력
2. CU12 인증 및 연동 과정에서 시스템 간 통신으로 수집
3. 서비스 이용 과정에서 자동 생성(로그, 세션, 동의 이력 등)
4. 관리자 기능(초대코드 발급/운영) 수행 과정

제5조(개인정보의 제3자 제공)
운영자는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.
다만 다음 경우에는 예외로 합니다.
1. 이용자가 사전에 동의한 경우
2. 법령에 근거가 있거나 수사기관 등의 적법한 요청이 있는 경우

제6조(개인정보 처리의 위탁 및 국외 이전)
운영자는 서비스 제공을 위해 아래 인프라/전송 경로를 이용할 수 있습니다.

1. 호스팅/애플리케이션 운영
- 수탁 대상: Vercel
- 처리 항목: 서비스 요청/응답 처리 과정에서의 데이터
- 목적: 웹 서비스 및 API 운영

2. 데이터베이스 운영
- 수탁 대상: Neon PostgreSQL
- 처리 항목: 계정/로그/동기화 데이터
- 목적: 데이터 저장 및 조회

3. 작업 실행 인프라
- 수탁 대상: GitHub Actions
- 처리 항목: 자동화 작업 실행에 필요한 최소 데이터
- 목적: 백그라운드 작업 처리

4. 이메일 발송
- 수탁 대상: 운영자가 설정한 SMTP 사업자
- 처리 항목: 수신 이메일 주소, 메일 본문/제목
- 목적: 알림/요약 메일 발송

운영자는 위탁계약 시 개인정보 보호 관련 법령을 준수하도록 관리·감독합니다.

제7조(이용자의 권리와 행사 방법)
이용자는 언제든지 개인정보 열람, 정정, 삭제, 처리정지, 동의 철회를 요청할 수 있습니다.
요청은 아래 연락처를 통해 접수할 수 있으며, 운영자는 지체 없이 조치합니다.

제8조(개인정보의 파기 절차 및 방법)
운영자는 개인정보 보유기간 경과 또는 처리목적 달성 시 지체 없이 파기합니다.
1. 전자적 파일: 복구가 불가능한 방법으로 영구 삭제
2. 출력물: 분쇄 또는 소각

제9조(개인정보의 안전성 확보조치)
운영자는 다음 조치를 시행합니다.
1. 접근권한 최소화 및 권한 관리
2. 비밀번호/민감정보 암호화 저장
3. 접속기록 및 감사로그 관리
4. 인증시도 제한 등 보안 통제
5. 정기 점검 및 취약점 대응

제10조(쿠키 및 세션)
서비스는 로그인 유지를 위해 쿠키를 사용합니다.
- cu12_session: 인증 세션 유지
- cu12_idle: 유휴 만료 관리
필수 쿠키를 차단할 경우 로그인 기반 기능 이용이 제한될 수 있습니다.

제11조(개인정보 보호책임자)
성명: {{DPO_NAME}}
직책: {{DPO_TITLE}}
이메일: {{DPO_EMAIL}}
전화: {{DPO_PHONE}}

제12조(문의처)
운영주체: {{COMPANY_NAME}}
대표 문의 이메일: {{SUPPORT_EMAIL}}
주소: {{COMPANY_ADDRESS}}

본 방침은 {{EFFECTIVE_DATE}}부터 적용됩니다.`,
  TERMS_OF_SERVICE: `이용약관

본 약관은 {{COMPANY_NAME}}(이하 "운영자")가 제공하는 {{COMPANY_NAME}} 서비스(이하 "서비스")의 이용과 관련하여 운영자와 이용자 간 권리·의무 및 책임사항을 규정합니다.

시행일: {{EFFECTIVE_DATE}}
최종 개정일: {{REVISION_DATE}}

제1조(목적)
본 약관은 서비스 이용조건 및 절차, 운영자와 이용자의 권리·의무, 책임사항을 정함을 목적으로 합니다.

제2조(정의)
1. "서비스"란 CU12, E-CYBER 연동 기반으로 학습/공지/알림 정보를 조회·처리하는 웹 서비스 및 관련 기능을 말합니다.
2. "이용자"란 본 약관에 동의하고 서비스를 이용하는 자를 말합니다.
3. "관리자"란 운영 권한(ADMIN)을 가진 이용자를 말합니다.
4. "초대코드"란 최초 이용자 등록 시 필요한 1회성 인증코드를 말합니다.

제3조(약관의 효력 및 변경)
1. 본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다.
2. 운영자는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있습니다.
3. 변경 시 적용일자 및 변경사유를 사전 공지합니다.
4. 이용자가 변경 약관 시행 후 서비스를 계속 이용하면 변경에 동의한 것으로 봅니다.

제4조(서비스의 제공)
운영자는 다음 기능을 제공합니다.
1. CU12, E-CYBER 계정 인증 및 연동
2. 강의/공지/학습/알림 정보 동기화
3. 자동화 작업(예: 동기화, 오토런) 요청 및 결과 제공
4. 이메일 알림/요약 발송(설정된 경우)
5. 관리자 운영 기능(초대코드/회원/작업 관리)

제5조(이용 자격 및 계정)
1. 이용자는 본인 명의 또는 정당한 권한이 있는 CU12, E-CYBER 계정으로만 서비스를 이용해야 합니다.
2. 최초 이용자는 운영자가 발급한 초대코드 검증을 완료해야 합니다.
3. 초대코드는 CU12 ID에 귀속되며 1회만 사용할 수 있습니다.
4. 이용자는 계정 정보의 정확성과 보안 유지 책임을 부담합니다.

제6조(필수 약관 동의 및 로그인 처리)
1. 이용자는 서비스 최초 이용 또는 약관 버전 갱신 시 필수 약관 동의를 완료해야 합니다.
2. 이용자가 필수 약관 동의를 거부하면 로그인은 완료되지 않으며 서비스 이용이 제한됩니다.
3. 운영자는 보안 및 계정 보호를 위해 마지막 로그인 일시와 IP를 저장할 수 있습니다.

제7조(이용자의 의무)
이용자는 다음 행위를 해서는 안 됩니다.
1. 타인의 계정/인증정보 도용
2. 서비스 또는 CU12 시스템에 대한 비정상적 접근·공격·우회 시도
3. 자동화 기능을 악용하여 과도한 트래픽 또는 장애를 유발하는 행위
4. 법령, 공서양속, 학교 정책에 반하는 행위
5. 운영자의 사전 승인 없는 상업적 이용 또는 재판매

제8조(서비스의 변경·중단)
1. 운영자는 시스템 점검, 장애 대응, 정책 변경 등으로 서비스 일부 또는 전부를 변경·중단할 수 있습니다.
2. 운영자는 필요한 경우 사전 공지하며, 긴급 상황에서는 사후 공지할 수 있습니다.

제9조(이용 제한 및 해지)
운영자는 다음 사유가 있는 경우 이용 제한 또는 계정 해지 조치를 할 수 있습니다.
1. 본 약관 또는 관련 법령 위반
2. 보안 위협 또는 운영 안정성 저해 행위
3. 장기간 미사용 또는 운영정책 위반

제10조(지식재산권)
서비스에 관한 저작권 및 지식재산권은 운영자 또는 정당한 권리자에게 귀속됩니다.
이용자는 운영자의 사전 서면 동의 없이 서비스의 전부 또는 일부를 복제·배포·2차 저작할 수 없습니다.

제11조(면책)
1. 운영자는 천재지변, 외부 시스템 장애(CU12, GitHub, Vercel, DB, SMTP 등), 통신 장애로 인한 서비스 중단에 대해 책임을 지지 않습니다.
2. CU12 사이트 구조/정책 변경으로 인해 일부 기능이 지연·실패할 수 있으며, 운영자는 합리적 범위에서 복구를 시도합니다.
3. 자동화 기능 결과의 최종 확인 책임은 이용자에게 있습니다.
4. 운영자는 이용자 귀책 사유로 발생한 손해에 대해 책임을 지지 않습니다.

제12조(손해배상)
운영자 또는 이용자가 본 약관을 위반하여 상대방에게 손해를 발생시킨 경우, 귀책 있는 당사자는 관련 법령에 따라 손해를 배상할 책임을 집니다.

제13조(준거법 및 관할)
1. 본 약관은 대한민국 법령을 준거법으로 합니다.
2. 서비스 이용과 관련한 분쟁은 {{JURISDICTION_COURT}}을 전속적 합의관할로 합니다.

제14조(문의)
운영주체: {{COMPANY_NAME}}
이메일: {{SUPPORT_EMAIL}}
주소: {{COMPANY_ADDRESS}}
개인정보 보호책임자: {{DPO_NAME}} / {{DPO_TITLE}}
개인정보 문의: {{DPO_EMAIL}} / {{DPO_PHONE}}

부칙
본 약관은 {{EFFECTIVE_DATE}}부터 시행합니다.`,
};

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

function formatKoreanDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}년${month}월${day}일`;
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
          createdAt: true,
        },
      });

      if (profile) {
        const existingVersionOneRows = await prisma.policyDocument.findMany({
          where: {
            version: 1,
            type: {
              in: ["PRIVACY_POLICY", "TERMS_OF_SERVICE"],
            },
          },
          select: {
            type: true,
          },
        });
        const existingVersionOneTypes = new Set(existingVersionOneRows.map((row) => row.type));
        const legacyDate = formatKoreanDate(profile.createdAt ?? new Date());
        const legacyProfile = {
          ...profile,
          effectiveDate: legacyDate,
          revisionDate: legacyDate,
        };

        let seededCount = 0;
        for (const [type, template] of Object.entries(LEGACY_V1_TEMPLATES)) {
          if (existingVersionOneTypes.has(type)) {
            continue;
          }

          const rendered = renderPolicyContent(template, legacyProfile);
          await prisma.policyDocument.create({
            data: {
              type,
              version: 1,
              content: rendered,
              templateContent: template,
              publishedContent: rendered,
              isActive: false,
              createdAt: profile.createdAt ?? new Date(),
              updatedAt: profile.createdAt ?? new Date(),
            },
          });
          seededCount += 1;
        }

        console.log(`[db-sync] Seeded ${seededCount} legacy v1 policy rows.`);

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
} finally {
  await prisma.$disconnect();
}
