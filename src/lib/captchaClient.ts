"use client";

declare global {
  interface Window {
    grecaptcha?: any;
  }
}

export async function executeCaptcha(action = "submit") {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";
  if (!siteKey) {
    // No client site key configured — return empty token so server can decide.
    return "";
  }

  // Load the grecaptcha script once
  if (!window.grecaptcha) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src*="recaptcha"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load recaptcha")),
        );
        return;
      }
      const s = document.createElement("script");
      s.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load recaptcha"));
      document.head.appendChild(s);
    });
  }

  return await new Promise<string>((resolve, reject) => {
    try {
      window.grecaptcha.ready(() => {
        window.grecaptcha
          .execute(siteKey, { action })
          .then((token: string) => resolve(token))
          .catch(reject);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export default executeCaptcha;
