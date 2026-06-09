type CaptchaResult = {
  success: boolean;
  score?: number;
  action?: string;
  errorCodes?: string[];
};

export async function verifyCaptcha(
  token?: string,
  action?: string,
  remoteip?: string,
): Promise<CaptchaResult> {
  if (!token) return { success: false, errorCodes: ["missing-token"] };

  const provider = (process.env.CAPTCHA_PROVIDER || "recaptcha").toLowerCase();

  if (provider === "recaptcha") {
    const secret = process.env.RECAPTCHA_SECRET;
    if (!secret) return { success: true }; // no server-side secret configured => bypass

    const params = new URLSearchParams();
    params.append("secret", secret);
    params.append("response", token);
    if (remoteip) params.append("remoteip", remoteip);

    const resp = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
    const json = await resp.json().catch(() => ({}));

    const scoreThreshold = parseFloat(
      process.env.RECAPTCHA_SCORE_THRESHOLD || "0.5",
    );
    const success =
      !!json.success &&
      (json.score === undefined || json.score >= scoreThreshold);

    if (!success) {
      return {
        success: false,
        score: json.score,
        action: json.action,
        errorCodes: json["error-codes"],
      };
    }

    if (action && json.action && action !== json.action) {
      return {
        success: false,
        score: json.score,
        action: json.action,
        errorCodes: ["action-mismatch"],
      };
    }

    return { success: true, score: json.score, action: json.action };
  }

  if (provider === "hcaptcha") {
    const secret = process.env.HCAPTCHA_SECRET;
    if (!secret) return { success: true };

    const params = new URLSearchParams();
    params.append("secret", secret);
    params.append("response", token);
    if (remoteip) params.append("remoteip", remoteip);

    const resp = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await resp.json().catch(() => ({}));
    const success = !!json.success;
    if (!success) return { success: false, errorCodes: json["error-codes"] };
    return { success: true };
  }

  // Unknown provider - allow by default to avoid blocking if env misconfigured
  return { success: true };
}

export default verifyCaptcha;
