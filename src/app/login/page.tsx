"use client";
import { Suspense }                          from "react";
import { useMemo, useState, useEffect }      from "react";
import { useRouter, useSearchParams }        from "next/navigation";
import Link                                  from "next/link";
import { motion }                            from "framer-motion";
import { createClient }                      from "@/lib/supabase/client";
import { useAuth }                           from "@/components/AuthProvider";
import { cn }                                from "@/lib/cn";

// ─── Inner component needs useSearchParams → put inside <Suspense> ────────────
function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, refresh } = useAuth();

  // Stable supabase instance — never recreated on re-renders
  const supabase = useMemo(() => createClient(), []);

  // Honour ?mode=register from the navbar "Get started" button
  const initialMode = searchParams.get("mode") === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(initialMode);

  // Where to send the user after a successful auth
  // (middleware sets ?redirect when bouncing unauthenticated users away from protected routes)
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

  const [form,      setForm]      = useState({ username: "", email: "", password: "" });
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  // Show "check your email" screen after sign-up when email confirmation is required
  const [emailSent, setEmailSent] = useState(false);

  // If middleware redirected us here (?redirect param is set), it means the server
  // couldn't validate the session cookie. Don't auto-redirect back — that creates
  // an infinite loop between the login page and the middleware. Show the form and
  // let the user sign in, which will re-establish the session cookie server-side.
  //
  // Only auto-redirect when the user navigated to /login directly while already
  // authenticated (e.g. clicking the nav "Sign in" link by mistake).
  const fromMiddleware = searchParams.has("redirect");

  useEffect(() => {
    if (!authLoading && user && !fromMiddleware) {
      router.replace(redirectTo);
    }
  }, [user, authLoading, router, redirectTo, fromMiddleware]);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "register") {
        const { data, error: err } = await supabase.auth.signUp({
          email:    form.email,
          password: form.password,
          options:  { data: { username: form.username } },
        });
        if (err) throw new Error(err.message);

        // Supabase returns a live session immediately when "Confirm email" is OFF,
        // but session = null when email confirmation is required.
        if (data.session) {
          await refresh();          // sync AuthProvider context
          router.replace(redirectTo);
        } else {
          setEmailSent(true);       // ask the user to check their inbox
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email:    form.email,
          password: form.password,
        });
        if (err) throw new Error(err.message);
        // AuthProvider's onAuthStateChange listener syncs state automatically;
        // router.replace is all we need — no extra refresh() call required.
        router.replace(redirectTo);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Still resolving session — show spinner instead of flashing the form
  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-60px)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white" />
      </div>
    );
  }

  // Email-confirmation holding screen
  if (emailSent) {
    return (
      <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6">
        <motion.div
          className="w-full max-w-[400px] text-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-4 text-4xl">📬</div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-white">
            Check your inbox
          </h2>
          <p className="text-[13px] text-[#94a3b8]">
            We sent a confirmation link to{" "}
            <strong className="text-white">{form.email}</strong>. Click it to
            activate your account, then{" "}
            <button
              type="button"
              onClick={() => { setEmailSent(false); setMode("login"); }}
              className="text-white underline underline-offset-2 hover:no-underline"
            >
              sign in
            </button>
            .
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-DEFAULT opacity-[0.06] blur-[120px] rounded-full pointer-events-none" />

      <motion.div
        className="w-full max-w-[400px] relative z-10"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <Link href="/" className="inline-flex items-center gap-2.5 no-underline">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[16px] font-black text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]">
              ⇢
            </div>
            <span className="font-display text-[20px] font-semibold tracking-tight text-white">
              Agentrail
            </span>
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-7 shadow-2xl">
          {/* Tab switcher */}
          <div className={cn(
            "mb-6 flex rounded-xl bg-white/5 p-1 gap-1 transition-opacity duration-200",
            loading && "opacity-40 pointer-events-none"
          )}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(""); }}
                disabled={loading}
                className={cn(
                  "flex-1 rounded-[9px] py-2 text-[13px] font-medium transition-all duration-200",
                  mode === m
                    ? "bg-white text-black shadow-sm"
                    : "text-[#94a3b8] hover:text-white"
                )}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* fieldset[disabled] mutes every child input/button simultaneously */}
            <fieldset
              disabled={loading}
              className={cn(
                "contents transition-opacity duration-200",
                loading && "opacity-40 pointer-events-none"
              )}
            >
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
                  Username
                </label>
                <input
                  className="input"
                  placeholder="your-username"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_-]+"
                  title="Letters, numbers, _ and - only"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
                Email
              </label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-[#94a3b8] uppercase tracking-[0.08em]">
                Password
              </label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            </fieldset>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary mt-2 w-full justify-center py-3 text-[14px]"
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-[#94a3b8]">
          <Link
            href="/"
            className="text-white/60 hover:text-white transition-colors underline underline-offset-2"
          >
            ← Back to home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

// ─── Page shell — wraps form in Suspense required by useSearchParams ──────────
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-60px)] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
