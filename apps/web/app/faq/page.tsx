import Link from "next/link";
import type { Metadata } from "next";
import type { Route } from "next";

export const metadata: Metadata = {
  title: "FAQ | Catholic University Automation",
  description: "Catholic University Automation 서비스 이용 전 자주 묻는 질문을 확인할 수 있습니다.",
};

const FAQ_ITEMS = [
  {
    question: "이 서비스는 일반 사용자 기준으로 어떻게 동작하나요?",
    answers: [
      "사용자가 CU12 또는 가톨릭대학교 사이버캠퍼스 계정으로 로그인하면, 서비스는 계정 상태를 확인한 뒤 대시보드에서 강의, 공지, 마감, 작업 상태를 제공합니다.",
      "필요한 경우 동기화 또는 자동학습 요청이 접수되며, 백그라운드 작업이 완료되면 결과와 알림이 반영됩니다. 최초 이용 시에는 포털 인증 후 관리자 승인 절차를 거쳐 계정이 등록됩니다.",
    ],
  },
  {
    question: "어떤 서비스를 지원하나요?",
    answers: [
      "본 서비스는 CU12와 가톨릭대학교 사이버캠퍼스를 모두 지원합니다.",
      "로그인, 학습 정보 조회, 동기화, 자동학습, 알림 기능은 계정 상태와 서비스별 지원 범위에 따라 동작하며, 세부 동작 범위는 두 서비스 간에 일부 차이가 있을 수 있습니다.",
    ],
  },
  {
    question: "운영자가 내 계정 아이디와 비밀번호를 바로 확인할 수 있나요?",
    answers: [
      "로그인 정보는 저장 시 암호화되며, 일반 운영 화면에서 비밀번호를 직접 조회하는 기능은 제공하지 않습니다.",
      "다만 본 서비스는 사용자를 대신하여 CU12 또는 가톨릭대학교 사이버캠퍼스에 로그인하고 작업을 수행하는 구조이므로, 서버 운영 환경에서는 해당 자격정보를 사용할 수 있는 구조입니다. 이용 전 이 점을 충분히 검토하시기 바랍니다.",
    ],
  },
  {
    question: "어떤 정보가 저장되나요?",
    answers: [
      "서비스 운영에 필요한 범위 내에서 계정 식별 정보, 암호화된 로그인 정보, 강의·공지·마감·진도 동기화 결과, 작업 이력, 메일 알림 설정이 저장될 수 있습니다.",
      "최근 로그인 시각 및 IP, 운영 점검용 로그 역시 보안 및 장애 대응 목적으로 저장될 수 있습니다.",
    ],
  },
  {
    question: "운영자가 내 학습 현황이나 공지를 볼 수 있나요?",
    answers: [
      "운영 및 장애 대응을 위해 사용자 화면 기준의 상태 정보를 확인할 수 있습니다.",
      "해당 확인은 운영 및 오류 대응 목적에 한정되며, 일반 사용자에게 공개되지 않습니다.",
    ],
  },
  {
    question: "자동화 범위는 어디까지인가요?",
    answers: [
      "본 서비스의 자동화 범위는 강의/VOD, 자료 학습, 일부 퀴즈 처리 중심입니다.",
      "과제, 시험, 토론, 설문 등 민감하거나 별도 판단이 필요한 항목은 자동 제출 대상으로 안내하지 않습니다.",
    ],
  },
  {
    question: "자동학습 요청 후 브라우저를 계속 켜 두어야 하나요?",
    answers: [
      "자동학습은 서버 작업으로 처리되므로 요청 후 페이지에 계속 머물 필요는 없습니다. 결과는 대시보드 작업 상태와 메일 알림 설정에 따라 확인할 수 있습니다.",
      "메일 알림, 공유대 정기 자동 수강, 퀴즈 자동 풀이 같은 옵션은 로그인 후 회원 설정에서 조정할 수 있습니다. 사이버캠퍼스는 2차 인증 제약이 있어 필요할 때 사용자가 직접 요청하고 인증을 완료해야 합니다.",
    ],
  },
  {
    question: "AI가 내 퀴즈나 수업 내용을 처리하나요?",
    answers: [
      "퀴즈 자동응답 기능이 활성화되어 있고 관련 설정이 구성된 경우에는 문제, 보기, 문맥 정보가 외부 AI API로 전달될 수 있습니다.",
      "해당 기능을 사용하지 않는 경우 이러한 유형의 외부 전송은 발생하지 않습니다.",
    ],
  },
  {
    question: "왜 로그인 상태가 자주 종료되나요?",
    answers: [
      "보안을 위해 일정 시간 활동이 없으면 세션이 자동으로 종료될 수 있습니다. 이는 개인 정보 보호와 공용 기기 사용 위험을 줄이기 위한 정책입니다.",
      "로그인 화면의 ID 저장 기능은 아이디만 브라우저에 저장하며, 비밀번호를 브라우저에 저장하는 기능은 제공하지 않습니다.",
    ],
  },
  {
    question: "관리자 승인이 필요한 이유와 동작 방식은 무엇인가요?",
    answers: [
      "본 서비스는 동기화, 자동학습, 메일 알림, 백그라운드 작업 처리 등 지속적인 서버 자원을 사용합니다. 운영 가능한 사용자 수와 작업량을 관리하기 위해 최초 이용 시 관리자 승인 절차를 둡니다.",
      "사용자는 먼저 실제 포털 ID와 비밀번호로 로그인해 본인 계정임을 검증합니다. 신규 사용자는 승인 대기 상태로 등록되며, 관리자가 승인한 뒤 다시 로그인하면 계정 연동과 약관 동의 절차가 이어집니다.",
    ],
  },
] as const;

export default function FaqPage() {
  return (
    <main className="dashboard-main page-shell faq-main">
      <section className="card faq-hero">
        <div className="faq-hero-copy">
          <p className="brand-kicker">FAQ</p>
          <h1>자주 묻는 질문</h1>
          <p className="muted">
            계정 연동 방식, 지원 범위, 자동화 정책, 관리자 승인 절차와 관련하여 자주 접수되는 문의를 정리했습니다.
          </p>
          <p className="muted text-small">
            운영 정책 또는 구현이 변경되는 경우 본 페이지 내용도 함께 조정될 수 있습니다.
          </p>
        </div>
        <div className="faq-links">
          <Link href={"/login" as Route} className="ghost-btn">
            로그인으로 돌아가기
          </Link>
          <Link href={"/privacy" as Route} className="ghost-btn">
            개인정보처리방침
          </Link>
          <Link href={"/terms" as Route} className="ghost-btn">
            이용약관
          </Link>
        </div>
      </section>

      <section className="card faq-alert" aria-label="투명성 안내">
        <strong>투명성 안내</strong>
        <p className="muted">
          개인정보 처리 방식이나 서비스 동작 구조가 우려되는 경우, 공개 저장소에서 구현과 문서를 직접 확인하실 수 있습니다.
        </p>
        <div className="faq-links">
          <a
            href="https://github.com/OneTop4458/cu12"
            target="_blank"
            rel="noreferrer"
            className="ghost-btn"
          >
            공개 저장소 보기
          </a>
        </div>
      </section>

      <section className="faq-list" aria-label="FAQ 목록">
        {FAQ_ITEMS.map((item) => (
          <article key={item.question} className="card faq-item">
            <h2 className="faq-question">Q. {item.question}</h2>
            <div className="faq-answer">
              {item.answers.map((answer) => (
                <p key={answer}>{answer}</p>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
