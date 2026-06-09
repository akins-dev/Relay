import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveUser } from "@/lib/auth-server";
import { rateLimit, getLimitConfig } from "@/lib/ratelimit";
import { createServiceClient } from "@/lib/supabase/server";

const Schema = z.object({
  password: z.string().min(8),
  token: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const rlConfig = await getLimitConfig("auth");
  const rl = await rateLimit(`auth:pwreset_submit:${ip}`, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  try {
    const body = Schema.parse(await req.json());

    // If the client provided the recovery token in the POST body (fallback),
    // use it to identify the user and perform a service-role admin update.
    if (body.token) {
      try {
        const sup = createClient();
        const {
          data: { user },
        } = await sup.auth
          .getUser(body.token as string)
          .catch(() => ({ data: { user: null } }));
        if (!user)
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        try {
          const svc = createServiceClient();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const adminRes: any = await (svc.auth as any).admin.updateUserById(
            user.id,
            { password: body.password },
          );
          if (adminRes?.error) {
            console.error("[auth/reset] admin update failed", adminRes.error);
            return NextResponse.json(
              { error: "Failed to reset password" },
              { status: 500 },
            );
          }

          try {
            await svc.from("security_incidents").insert({
              ip,
              user_id: user.id,
              incident: "pwreset_success_admin",
              detail: { method: "admin_update_token_fallback" },
              severity: "low",
            });
          } catch (e) {
            console.error("[auth/reset] failed to log admin success", e);
          }

          return NextResponse.json({ success: true });
        } catch (e: any) {
          console.error("[auth/reset] admin fallback error", e?.message ?? e);
          return NextResponse.json(
            { error: "Failed to reset password" },
            { status: 500 },
          );
        }
      } catch (e: any) {
        console.error("[auth/reset] token lookup failed", e?.message ?? e);
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Default: resolve user from Authorization header or cookie session
    const { user, supabase } = await resolveUser(req);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Attempt to update the current user's password using their session
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateRes: any = await (supabase.auth as any).updateUser({
        password: body.password,
      });
      if (updateRes?.error) throw updateRes.error;

      // Log success (low severity)
      try {
        const svc = createServiceClient();
        await svc.from("security_incidents").insert({
          ip,
          user_id: user.id,
          incident: "pwreset_success",
          detail: { method: "session_update" },
          severity: "low",
        });
      } catch (e) {
        console.error("[auth/reset] failed to log success", e);
      }

      return NextResponse.json({ success: true });
    } catch (err: any) {
      console.error(
        "[auth/reset] session update failed, trying admin fallback:",
        err?.message ?? err,
      );
      // Fallback: use service-role to update the user directly (for certain edge cases)
      try {
        const svc = createServiceClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adminRes: any = await (svc.auth as any).admin.updateUserById(
          user.id,
          { password: body.password },
        );
        if (adminRes?.error) {
          console.error("[auth/reset] admin update failed", adminRes.error);
          return NextResponse.json(
            { error: "Failed to reset password" },
            { status: 500 },
          );
        }

        try {
          await svc.from("security_incidents").insert({
            ip,
            user_id: user.id,
            incident: "pwreset_success_admin",
            detail: { method: "admin_update" },
            severity: "low",
          });
        } catch (e) {
          console.error("[auth/reset] failed to log admin success", e);
        }

        return NextResponse.json({ success: true });
      } catch (e: any) {
        console.error("[auth/reset] admin fallback error", e?.message ?? e);
        return NextResponse.json(
          { error: "Failed to reset password" },
          { status: 500 },
        );
      }
    }
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
