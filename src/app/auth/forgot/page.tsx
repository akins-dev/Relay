"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { executeCaptcha } from "@/lib/captchaClient";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const captchaToken = await executeCaptcha('pwreset');
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaToken }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || "Failed to send reset email");
        setLoading(false);
        return;
      }
      setSent(true);
      // start a cooldown so the resend button isn't immediately clickable
      setResendCooldown(60);
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  if (sent) {
    return (
      <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6">
        <motion.div
          className="w-full max-w-[420px] text-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-4 text-4xl">📬</div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-white">
            Check your inbox
          </h2>
          <p className="text-[13px] text-[#94a3b8]">
            If an account exists for{" "}
            <strong className="text-white">{email}</strong>, you will receive an
            email with instructions to reset your password.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (loading || resendCooldown > 0) return;
                setLoading(true);
                setResendCooldown(3);
                setError("");
                try {
                    const captchaToken = await executeCaptcha('pwreset');
                    const res = await fetch("/api/auth/forgot", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email, captchaToken }),
                    });
                  if (!res.ok) {
                    if (res.status === 429) {
                      const j = await res.json().catch(() => ({}));
                      const retry =
                        j?.retryAfter ?? res.headers.get("Retry-After");
                      setError(
                        `Too many requests. Try again in ${retry ?? "a few"} seconds.`,
                      );
                      return;
                    }
                    const j = await res.json().catch(() => ({}));
                    setError(j?.error || "Failed to resend");
                    return;
                  }
                } catch (err: any) {
                  setError(err?.message ?? "Network error");
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || resendCooldown > 0}
              className={cn(
                "btn btn-secondary px-4 py-2",
                (loading || resendCooldown > 0) &&
                  "opacity-60 pointer-events-none",
              )}
            >
              {loading
                ? "Resending…"
                : resendCooldown > 0
                  ? `Resend email (${resendCooldown}s)`
                  : "Resend email"}
            </button>
            <Link
              href="/login"
              className="text-white/60 hover:text-white underline underline-offset-2 flex items-center"
            >
              Return to sign in
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-white">
            Reset your password
          </h1>
          <p className="text-sm text-[#94a3b8] mt-2">
            Enter the email address for your account and we&apos;ll send a link to
            reset your password.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        >
          <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
            Email
          </label>
          <input
            className="input mb-4"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            className={cn(
              "btn btn-primary w-full py-3",
              loading && "opacity-60 pointer-events-none",
            )}
            disabled={loading}
          >
            {loading ? "Sending…" : "Send reset email"}
          </button>

          <p className="mt-4 text-center text-[13px] text-[#94a3b8]">
            <Link
              href="/login"
              className="text-white/60 hover:text-white underline underline-offset-2"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
