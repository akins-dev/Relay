"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { cn } from "@/lib/cn";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const supabase = createClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "register") {
        const { error: err } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { username: form.username } },
        });
        if (err) throw new Error(err.message);
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (err) throw new Error(err.message);
      }
      await refresh();
      router.push("/dashboard");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
          <div className="mb-6 flex rounded-xl bg-white/5 p-1 gap-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-[9px] py-2 text-[13px] font-medium transition-all duration-200",
                  mode === m
                    ? "bg-white text-black shadow-sm"
                    : "text-brand-steel hover:text-white"
                )}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-brand-steel uppercase tracking-[0.08em]">
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
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-brand-steel uppercase tracking-[0.08em]">
                Email
              </label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-brand-steel uppercase tracking-[0.08em]">
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
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary mt-2 w-full justify-center py-3 text-[14px]"
              disabled={loading}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-brand-steel">
          <Link href="/" className="text-white/60 hover:text-white transition-colors underline underline-offset-2">
            ← Back to home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
