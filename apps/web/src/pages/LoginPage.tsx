import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BrandLockup } from "../components/BrandLockup";
import { LoginForm } from "../components/LoginForm";
import { endpoints } from "../lib/api";
import { useLanguage } from "../lib/i18n";

export function LoginPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me, retry: false });
  const requestedReturn = searchParams.get("returnTo") ?? "/";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/";

  useEffect(() => {
    if (me.isSuccess) navigate(returnTo, { replace: true });
  }, [me.isSuccess, navigate, returnTo]);

  return (
    <main className="gg-login-page">
      <div className="gg-login-shell">
        <div className="gg-login-brand"><BrandLockup language={language} /></div>
        <p className="gg-login-subtitle">{language === "en" ? "Sign in or create an account with your phone number." : "使用手机号登录或创建账户。"}</p>
        <section className="gg-login-card">
        <LoginForm
          language={language}
          onSuccess={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["me"] }),
              queryClient.invalidateQueries({ queryKey: ["conversations"] })
            ]);
            navigate(returnTo, { replace: true });
          }}
        />
        </section>
        <p className="gg-login-tagline">One Conversation. Any Model. Any Compute.</p>
      </div>
    </main>
  );
}
