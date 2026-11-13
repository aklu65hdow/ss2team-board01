"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("");
  const err = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error");
  const redirectTo = () => `${window.location.origin}/auth/callback`;
  async function slack() {
    setState("Перенаправляю в Slack…");
    const { error } = await createClient().auth.signInWithOAuth({ provider: "slack_oidc", options: { redirectTo: redirectTo() } });
    if (error) setState("Не получилось открыть Slack: " + error.message);
  }
  async function mail(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("Отправляю ссылку…");
    const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
    setState(error ? "Не получилось отправить письмо: " + error.message : "Готово. Откройте письмо и нажмите на ссылку для входа.");
  }
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ padding: 0 }}>Командная доска<small>маркетинг · тесты · созвоны</small></div>
        <h1>Вход</h1>
        {err && <div className="banner">Ссылка для входа устарела или не сработала. Попробуйте ещё раз.</div>}
        <button className="btn primary big" onClick={slack}>Войти через Slack</button>
        <div className="or"><span>или по рабочей почте</span></div>
        <form onSubmit={mail} className="auth-form">
          <label className="f" htmlFor="email">Рабочая почта
            <input id="email" className="i" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <button className="btn big" type="submit">Прислать ссылку для входа</button>
        </form>
        {state && <div className="muted" role="status">{state}</div>}
        <div className="muted small">После первого входа администратор подтверждает доступ и назначает роль.</div>
      </div>
    </div>
  );
}
