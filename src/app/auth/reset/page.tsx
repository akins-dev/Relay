"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ResetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function init() {
      try {
        // Try to parse session from the URL hash (Supabase sends access_token in the fragment)
        // Prefer the official helper if available, otherwise fall back to manual fragment parsing.
        const anyAuth = supabase.auth as any;
        // Parse fragment and search params to be resilient to email clients that
        // may rewrite or drop URL fragments. We prefer fragment, then search.
        const maybeHash =
          typeof window !== "undefined"
            ? window.location.hash.substring(1)
            : "";
        const hashParams = new URLSearchParams(maybeHash);
        const searchParams = new URLSearchParams(
          typeof window !== "undefined" ? window.location.search : "",
        );

        const fragmentAccess = hashParams.get("access_token");
        const fragmentRefresh = hashParams.get("refresh_token");
        const searchAccess =
          searchParams.get("access_token") || searchParams.get("token");
        const searchRefresh = searchParams.get("refresh_token");

        if (typeof anyAuth.getSessionFromUrl === "function") {
          const res = await anyAuth.getSessionFromUrl();
          const session = res?.data?.session;
          const access_token =
            fragmentAccess || session?.access_token || searchAccess || null;
          const refresh_token =
            fragmentRefresh || session?.refresh_token || searchRefresh || null;
          if (access_token && typeof anyAuth.setSession === "function") {
            // Ensure the browser client is populated with the recovery session
            await anyAuth.setSession({ access_token, refresh_token });
            try {
              const after = await anyAuth.getSession?.();
              console.debug(
                "[auth/reset] post setSession (getSessionFromUrl)",
                {
                  hasSession: !!after?.data?.session,
                  userId: after?.data?.session?.user?.id,
                },
              );
            } catch {}
          }
          if (access_token) {
            setToken(access_token);
            try {
              if (typeof window !== "undefined" && window.location.hash)
                history.replaceState(
                  null,
                  "",
                  window.location.pathname + window.location.search,
                );
            } catch {}
          }
        } else {
          const access_token = fragmentAccess || searchAccess;
          const refresh_token = fragmentRefresh || searchRefresh;
          if (access_token && typeof anyAuth.setSession === "function") {
            await anyAuth.setSession({ access_token, refresh_token });
            try {
              const after = await anyAuth.getSession?.();
              console.debug("[auth/reset] post setSession (manual)", {
                hasSession: !!after?.data?.session,
                userId: after?.data?.session?.user?.id,
              });
            } catch {}
          }
          if (access_token) {
            setToken(access_token);
            try {
              if (typeof window !== "undefined" && window.location.hash)
                history.replaceState(
                  null,
                  "",
                  window.location.pathname + window.location.search,
                );
            } catch {}
          }
        }
      } catch (err) {
        // Non-fatal — user may have clicked an email with a provider-hosted reset page
        console.error("[auth/reset] session import failed", err);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const sb = createClient();

      // Try preferred client-side flow: use the local session (recovery token set above)
      try {
        // Ensure session exists (setSession already attempted in init); if not, attempt to set using stored token
        const sessionRes = await sb.auth.getSession();
        console.debug("[auth/reset] before updateUser - session", {
          hasSession: !!sessionRes?.data?.session,
          userId: sessionRes?.data?.session?.user?.id,
          hasToken: !!token,
        });
        if (
          !sessionRes?.data?.session &&
          token &&
          typeof (sb.auth as any).setSession === "function"
        ) {
          try {
            await (sb.auth as any).setSession({ access_token: token });
          } catch {}
        }

        // Attempt to update the user's password client-side
        const updateRes: any = await (sb.auth as any).updateUser({ password });
        if (updateRes?.error) {
          throw updateRes.error;
        }

        setSuccess(true);
        setTimeout(() => router.push("/login"), 2000);
        return;
      } catch (clientErr: any) {
        // If client-side update failed (token missing/expired), fall back to server route.
        console.warn(
          "[auth/reset] client update failed, falling back to server",
          clientErr?.message ?? clientErr,
          { hasToken: !!token },
        );
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const payload: any = { password };
        if (token) payload.token = token;
        const res = await fetch("/api/auth/reset", {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j?.error || "Failed to reset password");
          setSubmitting(false);
          return;
        }
        setSuccess(true);
        setTimeout(() => router.push("/login"), 2000);
        return;
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-60px)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6">
        <div className="w-full max-w-[420px] text-center">
          <div className="mb-4 text-4xl">✅</div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-white">
            Password updated
          </h2>
          <p className="text-[13px] text-[#94a3b8]">
            Your password has been updated. You will be redirected to the sign
            in page shortly.
          </p>
          <p className="mt-6">
            <Link
              href="/login"
              className="text-white/60 hover:text-white underline underline-offset-2"
            >
              Return to sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-white">
            Set a new password
          </h1>
          <p className="text-sm text-[#94a3b8] mt-2">
            Choose a new password for your account.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        >
          <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
            New password
          </label>
          <input
            className="input mb-4"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
            Confirm password
          </label>
          <input
            className="input mb-4"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full py-3"
            disabled={submitting}
          >
            {submitting ? "Updating…" : "Set new password"}
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
