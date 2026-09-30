"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  changePassword,
  deleteMfaFactor,
  startMfaEnrollment,
  unenrollMfa,
  verifyMfaEnrollment,
} from "@/app/dashboard/security/actions";
import { Spinner } from "@/components/spinner";
import Input from "@/components/ui/input";

type Message = { text: string; error: boolean };

type Enrollment = {
  qrCode: string;
  secret: string;
  uri: string;
};

type FactorView = {
  id: string;
  name: string | null;
  type: string;
  verified: boolean;
  addedAt: string;
};

const FACTOR_TYPE_LABELS: Record<string, string> = {
  totp: "تطبيق مصادقة (TOTP)",
  phone: "رسالة نصية (SMS)",
  webauthn: "مفتاح أمان (WebAuthn)",
  recovery_code: "رمز استرجاع",
};

export function SecurityManager({
  email,
  mfaEnrolled,
  factorName,
  enrolledAt,
  factors,
  factorsLoaded,
}: {
  email: string;
  mfaEnrolled: boolean;
  factorName: string | null;
  enrolledAt: string | null;
  factors: FactorView[];
  factorsLoaded: boolean;
}) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);
  const [confirmUnenroll, setConfirmUnenroll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mfaMsg, setMfaMsg] = useState<Message | null>(null);
  const [copied, setCopied] = useState<"secret" | "uri" | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<Message | null>(null);

  const pendingFactors = factors.filter((f) => !f.verified);

  const start = async () => {
    setEnrolling(true);
    setMfaMsg(null);
    const r = await startMfaEnrollment();
    if (r.error || !r.qrCode) {
      setMfaMsg({ text: r.error ?? "تعذّر بدء التسجيل.", error: true });
    } else {
      setEnrollment({
        qrCode: r.qrCode,
        secret: r.secret,
        uri: r.uri,
      });
    }
    setEnrolling(false);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setMfaMsg(null);
    const fd = new FormData();
    fd.set("code", code);
    const r = await verifyMfaEnrollment(fd);
    if (r.error) {
      setMfaMsg({ text: r.error, error: true });
    } else {
      setMfaMsg({
        text: "تم تفعيل المصادقة الثنائية. ستطلب رمز التحقق في كل تسجيل دخول.",
        error: false,
      });
      setEnrollment(null);
      setCode("");
      router.refresh();
    }
    setVerifying(false);
  };

  const unenroll = async () => {
    setUnenrolling(true);
    setMfaMsg(null);
    const r = await unenrollMfa();
    if (r.error) {
      setMfaMsg({ text: r.error, error: true });
    } else {
      setMfaMsg({
        text: "تم إيقاف المصادقة الثنائية. سيكفي تسجيل الدخول بكلمة المرور.",
        error: false,
      });
      setConfirmUnenroll(false);
      router.refresh();
    }
    setUnenrolling(false);
  };

  const removeFactor = async (id: string) => {
    setDeletingId(id);
    setMfaMsg(null);
    const r = await deleteMfaFactor(id);
    if (r.error) {
      setMfaMsg({ text: r.error, error: true });
    } else {
      setConfirmDeleteId(null);
      // The factor that was just deleted is the one the QR panel was enrolling,
      // so its secret is dead — drop the panel instead of leaving a code that
      // can never verify.
      setEnrollment(null);
      setCode("");
      router.refresh();
    }
    setDeletingId(null);
  };

  const copy = async (value: string, which: "secret" | "uri") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setMfaMsg({ text: "تعذّر النسخ. حدّد النص وانسخه يدويًا.", error: true });
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChanging(true);
    setPasswordMsg(null);
    const fd = new FormData();
    fd.set("currentPassword", currentPassword);
    fd.set("newPassword", newPassword);
    fd.set("confirmPassword", confirmPassword);
    const r = await changePassword(fd);
    if (r.error) {
      setPasswordMsg({ text: r.error, error: true });
    } else {
      setPasswordMsg({
        text: "تم تغيير كلمة المرور وإنهاء بقية الجلسات.",
        error: false,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      router.refresh();
    }
    setChanging(false);
  };

  return (
    <div className="mt-8 max-w-xl space-y-6">
      <section className="rounded-xl border bg-[var(--card)] p-5">
        <div className="mb-5">
          <p className="text-[15px] font-medium">
            المصادقة الثنائية (رمز من تطبيق المصادقة)
          </p>
          <p className="mt-1 text-[15px] text-[var(--muted)]">
            {mfaEnrolled ? (
              <span className="flex flex-col gap-1">
                <span className="text-[var(--success)]">مفعّلة.</span>
                <span>
                  العامل:{" "}
                  <b dir="ltr">{factorName ?? "Authenticator"}</b>
                  {enrolledAt && <> — أضيف في {enrolledAt}</>}
                </span>
              </span>
            ) : (
              "غير مفعّلة. يوصى بتفعيلها: بدونها تكفي كلمة المرور وحدها للدخول إلى اللوحة."
            )}
          </p>
        </div>

        {factors.length > 0 && (
          <ul className="mb-5 space-y-2">
            {factors.map((factor) => (
              <li
                key={factor.id}
                className="rounded-lg border border-[var(--border)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 text-[15px]">
                    <span className="font-medium" dir="ltr">
                      {factor.name ?? FACTOR_TYPE_LABELS[factor.type] ?? factor.type}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" — "}
                      {FACTOR_TYPE_LABELS[factor.type] ?? factor.type}
                    </span>
                    <div className="mt-0.5 text-sm text-[var(--muted)]">
                      {factor.verified ? (
                        <span className="text-[var(--success)]">مفعّل</span>
                      ) : (
                        <span>غير مكتمل — أُنشئ ولم يُفعّل بعد</span>
                      )}{" "}
                      — أضيف في {factor.addedAt}
                    </div>
                  </div>
                  {confirmDeleteId !== factor.id && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(factor.id)}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
                    >
                      حذف
                    </button>
                  )}
                </div>
                {confirmDeleteId === factor.id && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-[15px]">
                      {factor.verified
                        ? "سيتوقف طلب رمز التحقق عند تسجيل الدخول، ويكفي كلمة المرور. متابعة؟"
                        : "سيُحذف هذا العامل غير المكتمل. متابعة؟"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => removeFactor(factor.id)}
                        disabled={deletingId === factor.id}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                      >
                        {deletingId === factor.id && <Spinner size={14} />}
                        تأكيد الحذف
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingId === factor.id}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                      >
                        تراجع
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!factorsLoaded && (
          <p className="mb-5 text-[15px] text-[var(--danger)]">
            تعذّر قراءة قائمة عوامل المصادقة الثنائية. أعد تحميل الصفحة.
          </p>
        )}

        {pendingFactors.length > 0 && (
          <p className="mb-5 text-[15px] text-[var(--muted)]">
            يوجد عامل غير مكتمل من محاولة تسجيل سابقة. يمكنك حذفه والبدء من
            جديد.
          </p>
        )}

        {mfaMsg && (
          <p
            className={`mb-4 text-[15px] ${mfaMsg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
          >
            {mfaMsg.text}
          </p>
        )}

        {!mfaEnrolled && !enrollment && (
          <button
            type="button"
            onClick={start}
            disabled={enrolling}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {enrolling && <Spinner />}
            تفعيل المصادقة الثنائية
          </button>
        )}

        {mfaEnrolled && !confirmUnenroll && (
          <button
            type="button"
            onClick={() => setConfirmUnenroll(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
          >
            إيقاف المصادقة الثنائية
          </button>
        )}

        {mfaEnrolled && confirmUnenroll && (
          <div className="rounded-lg border border-[var(--border)] p-4">
            <p className="text-[15px]">
              سيصبح الدخول بكلمة المرور وحدها. متابعة؟
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={unenroll}
                disabled={unenrolling}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--danger)] px-4 py-2.5 text-[15px] font-medium text-white transition-opacity disabled:opacity-50"
              >
                {unenrolling && <Spinner />}
                تأكيد الإيقاف
              </button>
              <button
                type="button"
                onClick={() => setConfirmUnenroll(false)}
                disabled={unenrolling}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] disabled:opacity-50"
              >
                تراجع
              </button>
            </div>
          </div>
        )}

        {enrollment && (
          <div className="rounded-lg border border-[var(--border)] p-4">
            <ol className="space-y-4 text-[15px]">
              <li>
                <p className="font-medium">
                  1. امسح الرمز بتطبيق المصادقة (Google Authenticator، Authy،
                  1Password…).
                </p>
                {/* Supabase returns the QR as a data: URL; CSP allows data: in
                    img-src. A plain <img> avoids next/image's SVG rules. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollment.qrCode}
                  alt="رمز QR لإعداد المصادقة الثنائية"
                  width={192}
                  height={192}
                  className="mt-3 size-48 rounded-lg bg-white p-2"
                />
              </li>
              <li>
                <p className="font-medium">
                  2. أو أدخل المفتاح يدويًا (احفظه في مكان آمن — هو الطريقة
                  الوحيدة لاستعادة الدخول إن ضاع الجهاز):
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code
                    dir="ltr"
                    className="flex-1 truncate rounded-lg border bg-transparent px-3 py-2 font-mono text-sm"
                  >
                    {enrollment.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(enrollment.secret, "secret")}
                    className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-[15px] text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    {copied === "secret" ? "تم النسخ" : "نسخ"}
                  </button>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-[var(--muted)]">
                    رابط الإعداد (otpauth)
                  </summary>
                  <div className="mt-2 flex items-center gap-2">
                    <code
                      dir="ltr"
                      className="flex-1 truncate rounded-lg border bg-transparent px-3 py-2 font-mono text-xs"
                    >
                      {enrollment.uri}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(enrollment.uri, "uri")}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-[15px] text-[var(--muted)] hover:text-[var(--foreground)]"
                    >
                      {copied === "uri" ? "تم النسخ" : "نسخ"}
                    </button>
                  </div>
                </details>
              </li>
              <li>
                <p className="font-medium">
                  3. أدخل الرمز المكوّن من 6 أرقام للتأكيد.
                </p>
                <form onSubmit={verify} className="mt-2">
                  <Input
                    label="رمز التحقق"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="tracking-[0.4em]"
                  />
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={verifying || code.length !== 6}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      {verifying && <Spinner />}
                      تأكيد وتفعيل
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEnrollment(null);
                        setCode("");
                        setMfaMsg(null);
                      }}
                      disabled={verifying}
                      className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] disabled:opacity-50"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </li>
            </ol>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-[var(--card)] p-5">
        <div className="mb-5">
          <p className="text-[15px] font-medium">كلمة المرور</p>
          <p className="mt-1 text-[15px] text-[var(--muted)]">
            للحساب <b dir="ltr">{email}</b>. عند تغييرها تُنهى بقية الجلسات
            المسجَّلة.
          </p>
        </div>
        <form onSubmit={submitPassword} className="space-y-4">
          <Input
            label="كلمة المرور الحالية"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Input
            label="كلمة المرور الجديدة"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            hint="8 أحرف على الأقل."
          />
          <Input
            label="تأكيد كلمة المرور الجديدة"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <button
            type="submit"
            disabled={
              changing || !currentPassword || !newPassword || !confirmPassword
            }
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {changing && <Spinner />}
            تغيير كلمة المرور
          </button>
          {passwordMsg && (
            <p
              className={`text-[15px] ${passwordMsg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
            >
              {passwordMsg.text}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
