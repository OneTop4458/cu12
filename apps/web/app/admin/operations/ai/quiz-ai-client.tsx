"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_QUIZ_MODEL, isQuizModelId, QUIZ_MODEL_OPTIONS, QUIZ_MODEL_PRICE_DATE } from "@cu12/core";
import { AppTopbar } from "../../../../components/layout/app-topbar";
import { readJsonBody } from "../../../../src/lib/client-response";
import styles from "./quiz-ai.module.css";

interface Props { initialUser: { email: string; role: "ADMIN" | "USER" } }
interface Settings { model: string }

export function AdminQuizAiClient({ initialUser }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_QUIZ_MODEL);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = QUIZ_MODEL_OPTIONS.find((item) => item.id === model);

  const load = useCallback(async () => {
    setBusy("load"); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/quiz-ai", { cache: "no-store" });
      const data = await readJsonBody<Settings>(response);
      if (!response.ok || !data || !isQuizModelId(data.model ?? "")) throw new Error();
      setSaved(data.model); setModel(data.model);
      setCustom(!QUIZ_MODEL_OPTIONS.some((item) => item.id === data.model));
    } catch { setError("AI 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save"); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/quiz-ai", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model.trim() }),
      });
      const data = await readJsonBody<Settings>(response);
      if (!response.ok || !data || !isQuizModelId(data.model ?? "")) throw new Error();
      setSaved(data.model); setModel(data.model);
      setMessage("모델을 저장했습니다. 다음 퀴즈 요청부터 적용됩니다.");
    } catch { setError("모델을 저장하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요."); }
    finally { setBusy(null); }
  }

  return <>
    <AppTopbar title="AI 설정" kicker="퀴즈 자동풀이" email={initialUser.email} role={initialUser.role}
      showAdminNav adminNavActivePath="/admin/operations/ai"
      onDashboard={() => router.push("/dashboard")}
      onLogout={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }} />
    <section className={`card ${styles.section}`}>
      <div><h2>퀴즈에 사용할 모델</h2><p className="muted">비용을 우선하면 Luna, 더 복잡한 문제에는 Terra 또는 Sol을 선택하세요.</p></div>
      {busy === "load" ? <p role="status">AI 설정을 불러오는 중입니다.</p> : null}
      {saved ? <p>현재 저장된 모델 <strong className={styles.model}>{saved}</strong></p> : null}
      {error ? <div role="alert"><p className="error-text">{error}</p>{saved === null ? <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void load()}>다시 불러오기</button> : null}</div> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      <form onSubmit={save}>
        <fieldset disabled={Boolean(busy) || saved === null} className={styles.fields}>
          <label className="field"><span>모델 선택</span>
            <select value={custom ? "custom" : model} onChange={(event) => {
              setMessage(null);
              if (event.target.value === "custom") setCustom(true);
              else { setCustom(false); setModel(event.target.value); }
            }}>
              {QUIZ_MODEL_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === DEFAULT_QUIZ_MODEL ? " · 기본 권장" : ""}</option>)}
              <option value="custom">모델 ID 직접 입력</option>
            </select>
          </label>
          {custom ? <label className="field"><span>OpenAI 모델 ID</span><input required maxLength={100} autoComplete="off"
            value={model} onChange={(event) => { setModel(event.target.value); setMessage(null); }} placeholder="gpt-5.6-luna" />
            <small className="muted">Chat Completions와 JSON 응답을 지원하며 현재 API 프로젝트에서 사용할 수 있는 모델을 입력하세요.</small>
          </label> : null}
          <div className={styles.price}>
            {selected ? <p>100만 토큰당 입력 <strong>${selected.inputPrice.toFixed(2)}</strong> · 출력 <strong>${selected.outputPrice.toFixed(2)}</strong></p>
              : <p>직접 입력한 모델의 가격과 지원 기능은 공식 문서에서 확인해 주세요.</p>}
            <p className="muted">{QUIZ_MODEL_PRICE_DATE} 기준 단가입니다. 실제 비용은 입력·출력과 추론 토큰 사용량에 따라 달라집니다.</p>
            <a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">OpenAI 모델 안내</a>
          </div>
          <div className={styles.actions}>
            <button type="submit" disabled={model.trim() === saved || !isQuizModelId(model.trim())}>{busy === "save" ? "저장 중..." : "모델 저장"}</button>
            <button type="button" className="ghost-btn" onClick={() => { setModel(DEFAULT_QUIZ_MODEL); setCustom(false); setMessage(null); }}>기본 모델 선택</button>
          </div>
        </fieldset>
      </form>
      <p className="muted">이미 처리 중인 요청은 기존 모델로 마무리됩니다. 모델 접근 권한과 실제 정답률은 별도 확인이 필요합니다.</p>
    </section>
  </>;
}
