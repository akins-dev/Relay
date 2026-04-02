"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
        if (err) {
          console.log({ err });
          throw new Error(err.message);
        }
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
      console.log({ erroe: e });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-10 text-center">
          <Link href="/" className="inline-flex items-center gap-2 no-underline">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[rgba(0,0,0,0.1)] bg-white text-[17px] font-black text-black shadow-sm">
              ⇢
            </div>
            <span className="font-display text-[18px] font-semibold tracking-tight text-[#0a0a0a]">Agentrail</span>
          </Link>
        </div>

        <div className="card p-8 shadow-sm">
          <div className="mb-6 flex rounded-xl bg-neutral-100 p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-[10px] py-1.5 font-medium text-[13px] transition-colors",
                  mode === m
                    ? "bg-white text-black shadow-sm"
                    : "text-neutral-500 hover:text-black"
                )}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-[0.06em]">
                  Username
                </label>
                <input
                  className="input !bg-[#fafafa]"
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
              <label className="mb-1.5 block text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-[0.06em]">
                Email
              </label>
              <input
                className="input !bg-[#fafafa]"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-[0.06em]">
                Password
              </label>
              <input
                className="input !bg-[#fafafa]"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && (
              <div className="rounded-[12px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary mt-2 w-full justify-center py-3 text-[14px] transition-opacity"
              disabled={loading}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-[12px] text-[#a1a1aa]">
          <Link href="/" className="text-black underline transition-colors hover:text-neutral-700">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
