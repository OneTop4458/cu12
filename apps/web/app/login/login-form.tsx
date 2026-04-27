"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { readJsonBody, resolveClientResponseError } from "../../src/lib/client-response";

type SessionExpiredReason = "session-timeout" | "session-expired";
type Campus = "SONGSIM" | "SONGSIN";
type PortalProvider = "CU12" | "CYBER_CAMPUS";
type PolicyType = "PRIVACY_POLICY" | "TERMS_OF_SERVICE";
type PolicyConsentMode = "INITIAL_REQUIRED" | "UPDATED_REQUIRED";

interface SessionPolicy {
  rememberSession: boolean;
  sessionMaxAgeSeconds: number;
  idleMaxAgeSeconds: number;
}

interface AuthenticatedResponse {
  stage: "AUTHENTICATED";
  user: {
    userId: string;
    provider?: PortalProvider;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
  session?: SessionPolicy;
}

interface InviteRequiredResponse {
  stage: "INVITE_REQUIRED";
  challengeToken: string;
}

interface PolicyDocumentResponse {
  type: PolicyType;
  title: string;
  version: number;
  content: string;
}

interface PolicyChangeResponse {
  type: PolicyType;
  title: string;
  currentVersion: number;
  previousVersion: number | null;
  currentPath: string;
  previousPath: string | null;
  diffPath: string | null;
}

interface ConsentRequiredResponse {
  stage: "CONSENT_REQUIRED";
  consentToken: string;
  consentMode: PolicyConsentMode;
  policyChanges: PolicyChangeResponse[];
  policies: PolicyDocumentResponse[];
  user: {
    userId: string;
    provider?: PortalProvider;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
  session?: SessionPolicy;
}

interface ApiErrorResponse {
  error?: string;
  errorCode?: string;
}

type LoginResponse = AuthenticatedResponse | InviteRequiredResponse | ConsentRequiredResponse;

const LAST_ACTIVITY_STORAGE_KEY = "cu12:last-activity-at";
const SESSION_EXPIRED_STATE_KEY = "cu12:session-timeout-state";
const LEGACY_IDLE_TIMEOUT_STORAGE_KEY = "cu12:session-idle-timeout-ms";
const SAVED_CU12_ID_STORAGE_KEY = "cu12:saved-cu12-id";

const COPY = {
  campusSongsim: "\uC131\uC2EC\uAD50\uC815",
  campusSongsin: "\uC131\uC2E0\uAD50\uC815",
  cyberCampus: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4",
  authFailed: "ID \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  accountDisabled: "\uACC4\uC815\uC774 \uBE44\uD65C\uC131\uD654\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uAD00\uB9AC\uC790\uC5D0\uAC8C \uBB38\uC758\uD574 \uC8FC\uC138\uC694.",
  policyNotConfigured: "\uD544\uC218 \uC57D\uAD00\uC774 \uC544\uC9C1 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uAD00\uB9AC\uC790\uC5D0\uAC8C \uBB38\uC758\uD574 \uC8FC\uC138\uC694.",
  rateLimited: "\uC694\uCCAD\uC774 \uB9CE\uC544 \uC7A0\uC2DC \uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
  loginFallback: "\uB85C\uADF8\uC778 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  inviteFallback: "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  consentIncomplete: "\uD544\uC218 \uC57D\uAD00\uC5D0 \uBAA8\uB450 \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.",
  consentMismatch: "\uC57D\uAD00 \uBC84\uC804\uC774 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uCD5C\uC2E0 \uC57D\uAD00\uC5D0 \uB2E4\uC2DC \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.",
  consentFallback: "\uC57D\uAD00 \uB3D9\uC758 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  challengeInvalid: "\uB85C\uADF8\uC778 \uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
  consentSessionInvalid: "\uB3D9\uC758 \uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
  sessionExpiredTitle: "\uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5B4 \uB85C\uADF8\uC544\uC6C3 \uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
  sessionExpiredContent: "\uAC1C\uC778\uC815\uBCF4 \uBCF4\uD638 \uBC0F \uBCF4\uC548 \uAC15\uD654\uB97C \uC704\uD55C \uC790\uB3D9 \uB85C\uADF8\uC544\uC6C3 \uC815\uCC45\uC5D0 \uB530\uB77C \uC138\uC158\uC774 \uC885\uB8CC \uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
  accountIdLabel: "\uD3EC\uD138 \uACC4\uC815 ID",
  passwordLabel: "\uBE44\uBC00\uBC88\uD638",
  campusLabel: "\uCEA0\uD37C\uC2A4 \uC124\uC815",
  saveId: "ID \uC800\uC7A5",
  resetPassword: "\uBE44\uBC00\uBC88\uD638 \uCD08\uAE30\uD654",
  submit: "\uB85C\uADF8\uC778",
  submitting: "\uCC98\uB9AC \uC911...",
  networkLogin: "\uB85C\uADF8\uC778 \uC694\uCCAD \uC911 \uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  loginUnavailable: "\uB85C\uADF8\uC778 \uC11C\uBE44\uC2A4\uC5D0 \uC77C\uC2DC\uC801\uC73C\uB85C \uC811\uC18D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  emptyResponse: "\uC11C\uBC84 \uC751\uB2F5\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.",
  invalidResponse: "\uC11C\uBC84 \uC751\uB2F5\uC744 \uD574\uC11D\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
  inviteTitle: "\uCD08\uB300 \uCF54\uB4DC \uC785\uB825",
  inviteIntro: "\uAD00\uB9AC\uC790\uAC00 \uBC1C\uAE09\uD55C \uCD08\uB300 \uCF54\uB4DC\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
  inviteCode: "\uCD08\uB300 \uCF54\uB4DC",
  confirm: "\uD655\uC778",
  close: "\uB2EB\uAE30",
  inviteNetwork: "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  inviteSessionMissing: "\uCD08\uB300 \uCF54\uB4DC \uC778\uC99D \uC138\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
  inviteVerificationFailed: "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  consentTitle: "\uD544\uC218 \uC57D\uAD00 \uB3D9\uC758",
  consentIntro: "\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC744 \uC704\uD574 \uD544\uC218 \uC57D\uAD00\uC5D0 \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.",
  consentUpdateTitle: "\uC57D\uAD00 \uC5C5\uB370\uC774\uD2B8 \uC7AC\uB3D9\uC758",
  consentUpdateIntro: "\uAC1C\uC778\uC815\uBCF4 \uCC98\uB9AC \uBC29\uCE68 \uB610\uB294 \uC774\uC6A9\uC57D\uAD00\uC774 \uC5C5\uB370\uC774\uD2B8\uB418\uC5B4 \uCD5C\uC2E0 \uBC84\uC804\uC5D0 \uB2E4\uC2DC \uB3D9\uC758\uD574\uC57C \uD569\uB2C8\uB2E4.",
  consentUpdateHint: "\uBC84\uC804 \uBE44\uAD50 \uB9C1\uD06C\uB85C \uC2E0\uAD6C \uB0B4\uC6A9\uC744 \uD655\uC778\uD55C \uB4A4 \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.",
  consentRequired: "\uD544\uC218)",
  consentSubmit: "\uB3D9\uC758\uD558\uACE0 \uB85C\uADF8\uC778",
  consentDecline: "\uB3D9\uC758 \uAC70\uBD80",
  consentDeclineMessage: "\uD544\uC218 \uC57D\uAD00\uC5D0 \uB3D9\uC758\uD574\uC57C \uC11C\uBE44\uC2A4\uB97C \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  consentSessionMissing: "\uC57D\uAD00 \uB3D9\uC758 \uC138\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
  consentNetwork: "\uC57D\uAD00 \uB3D9\uC758 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
  consentFailed: "\uC57D\uAD00 \uB3D9\uC758 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
} as const;

const CAMPUS_OPTIONS: Array<{ value: Campus; label: string }> = [
  { value: "SONGSIM", label: COPY.campusSongsim },
  { value: "SONGSIN", label: COPY.campusSongsin },
];

function applySessionPolicy(policy: SessionPolicy | undefined) {
  if (typeof window === "undefined" || !policy) return;
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    window.localStorage.removeItem(SESSION_EXPIRED_STATE_KEY);
    window.localStorage.removeItem(LEGACY_IDLE_TIMEOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function syncSavedCu12Id(shouldSave: boolean, cu12Id: string) {
  if (typeof window === "undefined") return;
  try {
    if (!shouldSave) {
      window.localStorage.removeItem(SAVED_CU12_ID_STORAGE_KEY);
      return;
    }
    const trimmed = cu12Id.trim();
    if (!trimmed) {
      window.localStorage.removeItem(SAVED_CU12_ID_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SAVED_CU12_ID_STORAGE_KEY, trimmed);
  } catch {
    // Ignore storage errors.
  }
}

export function toLoginErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "AUTH_FAILED" || payload.errorCode === "CU12_AUTH_FAILED") {
    return COPY.authFailed;
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return COPY.accountDisabled;
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return COPY.policyNotConfigured;
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return COPY.rateLimited;
  }
  if (
    payload.errorCode === "CU12_UNAVAILABLE"
    || payload.errorCode === "CYBER_CAMPUS_UNAVAILABLE"
    || payload.errorCode === "PORTAL_UNAVAILABLE"
  ) {
    return payload.error ?? COPY.loginUnavailable;
  }
  if (payload.errorCode?.startsWith("INTERNAL_DB_") || payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? COPY.loginFallback;
  }
  return payload.error ?? COPY.loginFallback;
}

export function toInviteErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "INVITE_VERIFICATION_FAILED") {
    return payload.error ?? COPY.inviteVerificationFailed;
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return COPY.accountDisabled;
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return COPY.policyNotConfigured;
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return COPY.rateLimited;
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return COPY.challengeInvalid;
  }
  if (payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? COPY.inviteVerificationFailed;
  }
  return payload.error ?? COPY.inviteFallback;
}

export function toConsentErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "POLICY_CONSENT_INCOMPLETE") {
    return COPY.consentIncomplete;
  }
  if (payload.errorCode === "POLICY_VERSION_MISMATCH") {
    return COPY.consentMismatch;
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return COPY.policyNotConfigured;
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return COPY.consentSessionInvalid;
  }
  if (payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? COPY.consentFailed;
  }
  return payload.error ?? COPY.consentFallback;
}

export function getConsentModalCopy(mode: PolicyConsentMode): {
  title: string;
  intro: string;
} {
  if (mode === "UPDATED_REQUIRED") {
    return {
      title: COPY.consentUpdateTitle,
      intro: COPY.consentUpdateIntro,
    };
  }

  return {
    title: COPY.consentTitle,
    intro: COPY.consentIntro,
  };
}

export function LoginForm({
  sessionExpiredReason: initialSessionExpiredReason,
}: {
  sessionExpiredReason?: SessionExpiredReason;
}) {
  const router = useRouter();
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [saveCu12Id, setSaveCu12Id] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredReason] = useState<SessionExpiredReason | null>(() => {
    if (initialSessionExpiredReason) return initialSessionExpiredReason;
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(SESSION_EXPIRED_STATE_KEY);
      return raw === "session-timeout" || raw === "session-expired" ? raw : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedCu12Id = window.localStorage.getItem(SAVED_CU12_ID_STORAGE_KEY)?.trim() ?? "";
      if (!savedCu12Id) return;
      setCu12Id(savedCu12Id);
      setSaveCu12Id(true);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const [consentMode, setConsentMode] = useState<PolicyConsentMode>("INITIAL_REQUIRED");
  const [policyChanges, setPolicyChanges] = useState<PolicyChangeResponse[]>([]);
  const [consentPolicies, setConsentPolicies] = useState<PolicyDocumentResponse[]>([]);
  const [policyChecks, setPolicyChecks] = useState<Record<string, boolean>>({});
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const allPoliciesChecked = useMemo(
    () => consentPolicies.length > 0 && consentPolicies.every((policy) => policyChecks[policy.type] === true),
    [consentPolicies, policyChecks],
  );

  const isProcessing = submitting || inviteSubmitting || consentSubmitting;
  const processingMessage = submitting
    ? "\uB85C\uADF8\uC778 \uC694\uCCAD\uC744 \uCC98\uB9AC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."
    : inviteSubmitting
      ? "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778\uC744 \uCC98\uB9AC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."
      : consentSubmitting
        ? "\uC57D\uAD00 \uB3D9\uC758\uB97C \uCC98\uB9AC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."
        : null;

  function clearConsentState() {
    setShowConsentModal(false);
    setConsentToken(null);
    setConsentMode("INITIAL_REQUIRED");
    setPolicyChanges([]);
    setConsentPolicies([]);
    setPolicyChecks({});
    setConsentError(null);
  }

  function declineConsent() {
    clearConsentState();
    setError(COPY.consentDeclineMessage);
  }

  function startConsentFlow(payload: ConsentRequiredResponse) {
    const nextChecks: Record<string, boolean> = {};
    payload.policies.forEach((policy) => {
      nextChecks[policy.type] = false;
    });

    setShowInviteModal(false);
    setChallengeToken(null);
    setInviteCode("");
    setInviteError(null);

    setConsentToken(payload.consentToken);
    setConsentMode(payload.consentMode);
    setPolicyChanges(payload.policyChanges ?? []);
    setConsentPolicies(payload.policies ?? []);
    setPolicyChecks(nextChecks);
    setConsentError(null);
    setShowConsentModal(true);
  }

  const consentCopy = getConsentModalCopy(consentMode);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInviteError(null);
    setConsentError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id,
          cu12Password,
          campus,
          rememberSession: false,
        }),
      });

      if (!response.ok) {
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setError(COPY.invalidResponse);
          return;
        }
        setError(toLoginErrorMessage(payload ?? { error: resolveClientResponseError(response, payload, "Authentication failed.") }));
        return;
      }

      const payload = await readJsonBody<LoginResponse>(response);
      if (!payload) {
        setError(COPY.emptyResponse);
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
      if (payload.stage === "INVITE_REQUIRED") {
        clearConsentState();
        setChallengeToken(payload.challengeToken);
        setInviteCode("");
        setInviteError(null);
        setShowInviteModal(true);
        return;
      }

      if (payload.stage === "CONSENT_REQUIRED") {
        startConsentFlow(payload);
        return;
      }

      applySessionPolicy(payload.session);
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setError(COPY.networkLogin);
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      setInviteError(COPY.inviteSessionMissing);
      return;
    }

    setInviteSubmitting(true);
    setInviteError(null);
    setConsentError(null);

    try {
      const response = await fetch("/api/auth/login/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          inviteCode: inviteCode.trim(),
          rememberSession: false,
        }),
      });

      if (!response.ok) {
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setInviteError(COPY.invalidResponse);
          return;
        }

        const safePayload = payload ?? { error: resolveClientResponseError(response, payload, "Invite verification failed.") };
        const message = toInviteErrorMessage(safePayload);
        setInviteError(message);
        if (safePayload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setShowInviteModal(false);
          setChallengeToken(null);
          setError(message);
        }
        return;
      }

      const payload = await readJsonBody<AuthenticatedResponse | ConsentRequiredResponse>(response);
      if (!payload) {
        setInviteError(COPY.emptyResponse);
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
      if (payload.stage === "CONSENT_REQUIRED") {
        startConsentFlow(payload);
        return;
      }

      applySessionPolicy(payload.session);
      setShowInviteModal(false);
      setChallengeToken(null);
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setInviteError(COPY.inviteNetwork);
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function onSubmitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consentToken) {
      setConsentError(COPY.consentSessionMissing);
      return;
    }
    if (!allPoliciesChecked) {
      setConsentError(COPY.consentIncomplete);
      return;
    }

    setConsentSubmitting(true);
    setConsentError(null);

    try {
      const acceptedPolicies = consentPolicies.map((policy) => ({
        type: policy.type,
        version: policy.version,
      }));

      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consentToken,
          acceptedPolicies,
        }),
      });

      if (!response.ok) {
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setConsentError(COPY.invalidResponse);
          return;
        }
        const safePayload = payload ?? { error: resolveClientResponseError(response, payload, "Policy consent failed.") };
        const message = toConsentErrorMessage(safePayload);
        setConsentError(message);
        if (safePayload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          clearConsentState();
          setError(message);
        }
        return;
      }

      const payload = await readJsonBody<AuthenticatedResponse>(response);
      if (!payload) {
        setConsentError(COPY.emptyResponse);
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
      applySessionPolicy(payload.session);
      clearConsentState();
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setConsentError(COPY.consentNetwork);
    } finally {
      setConsentSubmitting(false);
    }
  }

  return (
    <div className="login-form-shell">
      {sessionExpiredReason ? (
        <div className="session-timeout-banner">
          <p><strong>{COPY.sessionExpiredTitle}</strong></p>
          <p>{COPY.sessionExpiredContent}</p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="form-stack">
        <Label className="field">
          <span>{COPY.accountIdLabel}</span>
          <Input
            value={cu12Id}
            onChange={(event) => setCu12Id(event.target.value)}
            autoComplete="username"
            required
            minLength={4}
            placeholder={"ID"}
          />
        </Label>

        <Label className="field">
          <span>{COPY.passwordLabel}</span>
          <Input
            type="password"
            value={cu12Password}
            onChange={(event) => setCu12Password(event.target.value)}
            autoComplete="current-password"
            required
            minLength={4}
            placeholder={COPY.passwordLabel}
          />
        </Label>

        <label className="field">
          <span>{COPY.campusLabel}</span>
          <select value={campus} onChange={(event) => setCampus(event.target.value as Campus)}>
            {CAMPUS_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className="login-options-row">
          <Label className="check-field">
            <Checkbox
              checked={saveCu12Id}
              onCheckedChange={(value) => {
                const checked = value === true;
                setSaveCu12Id(checked);
                if (!checked) {
                  syncSavedCu12Id(false, cu12Id);
                }
              }}
            />
            <span>{COPY.saveId}</span>
          </Label>
          <a
            className="btn ghost-btn login-reset-link"
            href="https://www.cu12.ac.kr/el/member/pw_reset_form.acl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {COPY.resetPassword}
          </a>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <Button type="submit" disabled={submitting} className="btn btn-success">
          {submitting ? <Loader2 className="spin" size={16} /> : null}
          {submitting ? COPY.submitting : COPY.submit}
        </Button>
      </form>

      {showInviteModal ? (
        <div className="modal-overlay" role="presentation" onClick={() => !inviteSubmitting && setShowInviteModal(false)}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={COPY.inviteTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{COPY.inviteTitle}</h2>
            <p className="muted">{COPY.inviteIntro}</p>

            <form onSubmit={onSubmitInvite} className="form-stack">
              <label className="field">
                <span>{COPY.inviteCode}</span>
                <Input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  placeholder={"ABCD-1234"}
                />
              </label>

              {inviteError ? <p className="error-text">{inviteError}</p> : null}

              <div className="button-row">
                <Button type="submit" disabled={inviteSubmitting} className="btn">
                  {inviteSubmitting ? COPY.submitting : COPY.confirm}
                </Button>
                <Button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowInviteModal(false)}
                  disabled={inviteSubmitting}
                  variant="outline"
                >
                  {COPY.close}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showConsentModal ? (
        <div className="modal-overlay" role="presentation">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={COPY.consentTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{consentCopy.title}</h2>
            <p className="muted">{consentCopy.intro}</p>
            {consentMode === "UPDATED_REQUIRED" ? (
              <p className="muted text-small">{COPY.consentUpdateHint}</p>
            ) : null}

            {consentMode === "UPDATED_REQUIRED" && policyChanges.length > 0 ? (
              <div className="top-gap">
                {policyChanges.map((change) => (
                  <article key={`${change.type}:${change.currentVersion}`} className="card">
                    <strong>{change.title}</strong>
                    <p className="muted text-small">
                      최신 v{change.currentVersion}
                      {change.previousVersion ? ` / 이전 v${change.previousVersion}` : ""}
                    </p>
                    <div className="button-row" style={{ justifyContent: "flex-start" }}>
                      <a className="ghost-btn" href={change.currentPath} target="_blank" rel="noreferrer">
                        최신 보기
                      </a>
                      {change.previousPath ? (
                        <a className="ghost-btn" href={change.previousPath} target="_blank" rel="noreferrer">
                          이전 보기
                        </a>
                      ) : null}
                      {change.diffPath ? (
                        <a className="ghost-btn" href={change.diffPath} target="_blank" rel="noreferrer">
                          신구 비교
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <form onSubmit={onSubmitConsent} className="form-stack top-gap">
              {consentPolicies.map((policy) => (
                <article key={policy.type} className="card">
                  <div className="button-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{policy.title}</strong>
                    <span className="muted">v{policy.version}</span>
                  </div>
                  <pre
                    style={{
                      marginTop: 8,
                      maxHeight: 180,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 10,
                      background: "var(--bg-soft)",
                    }}
                  >
                    {policy.content}
                  </pre>
                  <label className="check-field top-gap">
                    <Checkbox
                      checked={policyChecks[policy.type] === true}
                      onCheckedChange={(value) =>
                        setPolicyChecks((prev) => ({
                          ...prev,
                          [policy.type]: value === true,
                        }))}
                    />
                    <span>{`${policy.title} (${COPY.consentRequired}`}</span>
                  </label>
                </article>
              ))}

              {consentError ? <p className="error-text">{consentError}</p> : null}

              <div className="button-row">
                <Button type="submit" className="btn btn-success" disabled={consentSubmitting || !allPoliciesChecked}>
                  {consentSubmitting ? COPY.submitting : COPY.consentSubmit}
                </Button>
                <Button
                  type="button"
                  className="ghost-btn"
                  onClick={declineConsent}
                  disabled={consentSubmitting}
                  variant="outline"
                >
                  {COPY.consentDecline}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isProcessing && processingMessage ? (
        <p className="muted top-gap" aria-live="polite" aria-busy={isProcessing}>
          {processingMessage}
        </p>
      ) : null}
    </div>
  );
}
