import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { rateLimit, getLimitConfig } from "@/lib/ratelimit";
import { verifyCaptcha } from "@/lib/captcha";
import { createHash } from "crypto";

const Schema = z.object({
  email: z.string().email(),
  captchaToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const headers = req.headers;
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-client-ip") ||
    headers.get("x-cluster-client-ip") ||
    "unknown";
  // NOTE: Rate limiting for password reset is enforced per-email (not per-IP).
  // Per-email checks occur after parsing the request body below.

  try {
    const body = Schema.parse(await req.json());
    const supabase = createClient();
    const origin =
      process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
      
    // Normalize and hash the email so we never log raw addresses
    const emailNorm = body.email.trim().toLowerCase();
    const emailHash = createHash("sha256").update(emailNorm).digest("hex");

    // Per-email rate limit to prevent resending/harassment and enumeration
    const perEmailConfig = { limit: 5, windowMs: 60 * 60 * 1000 }; // 5 per hour
    const rlEmail = await rateLimit(
      `auth:pwreset:email:${emailHash}`,
      perEmailConfig,
    );
    try {
      console.debug("[auth/forgot] email rateLimit", {
        emailHash,
        allowed: rlEmail.allowed,
        remaining: rlEmail.remaining,
        resetAt: rlEmail.resetAt,
      });
    } catch (err) {
      // ignore
    }
    if (!rlEmail.allowed) {
      // Per-email limit exceeded — block the actual send but do NOT reveal
      // that the email exists. Log the event for operators (hashed email).
      try {
        const svc = createServiceClient();
        await svc.from("security_incidents").insert({
          ip,
          incident: "pwreset_rate_limited_email",
          detail: { email_hash: emailHash },
          severity: "medium",
        });
      } catch (err) {
        console.error(
          "[auth/forgot] failed to log email rate limit incident",
          err,
        );
      }

      // Return the same generic success message to avoid account enumeration.
      return NextResponse.json({
        message: "If an account exists, a password reset email has been sent.",
      });
    }

    // If server-side captcha is enabled, require a captcha token and verify it
    const hasServerCaptcha = !!(
      process.env.RECAPTCHA_SECRET || process.env.HCAPTCHA_SECRET
    );
    if (hasServerCaptcha) {
      if (!body.captchaToken) {
        return NextResponse.json(
          { error: "Captcha required" },
          { status: 400 },
        );
      }
      const ok = await verifyCaptcha(body.captchaToken, "pwreset", ip);
      if (!ok.success) {
        try {
          const svc = createServiceClient();
          await svc.from("security_incidents").insert({
            ip,
            incident: "pwreset_captcha_failed",
            detail: { email_hash: emailHash, captcha: ok },
            severity: "medium",
          });
        } catch (e) {}
        return NextResponse.json(
          { error: "Captcha verification failed" },
          { status: 400 },
        );
      }
    }

    // Best-effort: ask Supabase to send a password-reset email. We do not disclose
    // whether the user exists — the response to the client is always the same.
    try {
      const redirectTo = `${origin}/auth/reset`;
      const res: any = await (supabase.auth as any).resetPasswordForEmail(
        body.email,
        { redirectTo },
      );

      if (res?.error) {
        // Log failures for operators (use hashed email)
        try {
          const svc = createServiceClient();
          await svc.from("security_incidents").insert({
            ip,
            incident: "pwreset_send_failed",
            detail: { email_hash: emailHash, message: res.error.message },
            severity: "low",
          });
        } catch (err) {
          console.error(
            "[auth/forgot] failed to log pwreset send failure",
            err,
          );
        }
        // Debug: surface the Supabase error for operators (hashed email only)
        try {
          console.warn("[auth/forgot] supabase resetPasswordForEmail error", {
            emailHash,
            message: res.error.message,
          });
        } catch (e) {}
      }
    } catch (err: any) {
      console.error("[auth/forgot] supabase error:", {
        emailHash,
        message: err?.message ?? String(err),
      });
      try {
        const svc = createServiceClient();
        await svc.from("security_incidents").insert({
          ip,
          incident: "pwreset_send_exception",
          detail: {
            email_hash: emailHash,
            message: err?.message ?? String(err),
          },
          severity: "low",
        });
      } catch (e) {
        console.error("[auth/forgot] failed to log exception", e);
      }
    }

    return NextResponse.json({
      message: "If an account exists, a password reset email has been sent.",
    });
  } catch (e: any) {
    if (e?.errors)
      return NextResponse.json(
        { error: e.errors[0]?.message },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 },
    );
  }
}
