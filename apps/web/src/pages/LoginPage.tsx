import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
      <Link className="gg-login-back" to={returnTo} aria-label={language === "en" ? "Back" : "返回"}>
        <ArrowLeft size={18} />
      </Link>
      <section className="gg-login-card">
        <div className="gg-login-brand"><BrandLockup language={language} /></div>
        <div className="gg-login-copy">
          <h1>{language === "en" ? "Welcome back" : "欢迎回来"}</h1>
          <p>{language === "en" ? "Sign in with your phone number to continue." : "使用手机号登录以继续。"}</p>
        </div>
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
    </main>
  );
}
