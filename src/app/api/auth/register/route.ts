import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createHash } from "crypto";
import { rateLimit, getLimitConfig } from "@/lib/ratelimit";
import { verifyCaptcha } from "@/lib/captcha";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  captchaToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const body = Schema.parse(await req.json());

    // Normalize and hash email for rate-limiting and logging
    const emailNorm = body.email.trim().toLowerCase();
    const emailHash = createHash("sha256").update(emailNorm).digest("hex");

    const rlConfig = await getLimitConfig("auth");
    const rl = await rateLimit(`auth:register:email:${emailHash}`, rlConfig);
    if (!rl.allowed) {
      try {
        const svc = createServiceClient();
        await svc.from("security_incidents").insert({
          ip,
          incident: "register_rate_limited_email",
          detail: { email_hash: emailHash },
          severity: "medium",
        });
      } catch (e) {}
      return NextResponse.json(
        { error: "Too many registration attempts. Please wait a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    // If a captcha secret is configured on the server, require verification.
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
      const verified = await verifyCaptcha(body.captchaToken, "register", ip);
      if (!verified.success) {
        // Log hashed email for operator follow-up without exposing PII
        try {
          const svc = createServiceClient();
          await svc.from("security_incidents").insert({
            ip,
            incident: "register_captcha_failed",
            detail: { email_hash: emailHash, captcha: verified },
            severity: "medium",
          });
        } catch (e) {}
        return NextResponse.json(
          { error: "Captcha verification failed" },
          { status: 400 },
        );
      }
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { username: body.username } },
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      message: "Check your email to confirm your account.",
    });
  } catch (e: any) {
    if (e.errors)
      return NextResponse.json(
        { error: e.errors[0]?.message },
        { status: 400 },
      );
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
