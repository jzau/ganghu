import type { FormEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { brandText } from "../lib/branding";
import { localizeErrorMessage, type Language } from "../lib/i18n";
import { Button } from "./Button";

export const supportedCountries = [
  { label: { en: "China mainland", zh: "中国大陆" }, code: "+86", hint: "13800138000", pattern: /^1\d{10}$/ },
  { label: { en: "Hong Kong", zh: "中国香港" }, code: "+852", hint: "51234567", pattern: /^[23569]\d{7}$/ },
  { label: { en: "Japan", zh: "日本" }, code: "+81", hint: "9012345678", pattern: /^\d{9,10}$/ },
  { label: { en: "Australia", zh: "澳大利亚" }, code: "+61", hint: "412345678", pattern: /^\d{9}$/ }
] as const;

export type CountryCode = (typeof supportedCountries)[number]["code"];

const loginText = {
  en: {
    countryRegion: "Country / Region",
    phoneNumber: "Phone number",
    otpSent: "OTP sent to",
    sendOtp: "Send code",
    signIn: "Sign in",
    invalidPhone: (country: string) => `Enter a valid ${country} phone number.`,
    invalidOtp: "Enter the verification code.",
    failedToSendOtp: "Failed to send OTP",
    loginFailed: "Login failed",
    consentPrefix: "By signing up or logging in, you agree to GANGRAM AI’s",
    termsOfUse: "Terms of Service",
    privacyPolicy: "Privacy Policy",
    consentJoiner: "and",
    consentSuffix: "New phone numbers are registered automatically."
  },
  zh: {
    countryRegion: "国家 / 地区",
    phoneNumber: "手机号",
    otpSent: "验证码已发送至",
    sendOtp: "发送验证码",
    signIn: "登录",
    invalidPhone: (country: string) => `请输入有效的${country}手机号。`,
    invalidOtp: "请输入验证码。",
    failedToSendOtp: "验证码发送失败",
    loginFailed: "登录失败",
    consentPrefix: "注册或登录即表示您同意 GANGHU AI 的",
    termsOfUse: "使用条款",
    privacyPolicy: "隐私政策",
    consentJoiner: "和",
    consentSuffix: "新的手机号码将自动注册。"
  }
} as const;

export function LoginForm({
  language,
  onSuccess,
  header
}: {
  language: Language;
  onSuccess: () => void;
  header?: ReactNode;
}) {
  const t = loginText[language];
  const [countryCode, setCountryCode] = useState<CountryCode>("+86");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const countryMenu = useRef<HTMLDivElement>(null);
  const formId = useId();

  useEffect(() => {
    if (!countryMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !countryMenu.current?.contains(event.target)) setCountryMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setCountryMenuOpen(false); countryMenu.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [countryMenuOpen]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const country = supportedCountries.find((item) => item.code === countryCode) ?? supportedCountries[0];
  const localPhoneNumber = phoneNumber.replace(/\D/g, "");
  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verifyOtp();
  }

  function validatePhoneNumber() {
    if (!country.pattern.test(localPhoneNumber)) {
      setError(t.invalidPhone(country.label[language]));
      return false;
    }
    return true;
  }

  async function requestOtp() {
    setError("");
    if (!validatePhoneNumber()) return;

    try {
      setSending(true);
      await api("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ countryCode, phoneNumber: localPhoneNumber })
      });
      setCountdown(60);
    } catch (err) {
      setError(localizeErrorMessage(err, language, t.failedToSendOtp));
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    setError("");
    if (!validatePhoneNumber()) return;
    if (otp.trim().length !== 6) {
      setError(t.invalidOtp);
      return;
    }

    try {
      setSigningIn(true);
      await api("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ countryCode, phoneNumber: localPhoneNumber, otp: otp.trim() })
      });
      onSuccess();
    } catch (err) {
      setError(localizeErrorMessage(err, language, t.loginFailed));
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <form className="gg-login-form" onSubmit={submitLogin}>
      {header}
      <div className="gg-login-field-group"><label id={`${formId}-country-label`}>{t.countryRegion}</label>
      <div className="gg-country-picker" ref={countryMenu}>
        <button type="button" className="nm-field gg-country-trigger" aria-labelledby={`${formId}-country-label`} aria-haspopup="listbox" aria-expanded={countryMenuOpen}
          onClick={() => setCountryMenuOpen((open) => !open)} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCountryMenuOpen(true); requestAnimationFrame(() => countryMenu.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()); }
          }}>
          <span>{country.label[language]} ({countryCode})</span><ChevronDown size={14} aria-hidden="true" />
        </button>
        {countryMenuOpen && <div className="gg-country-options" role="listbox" aria-labelledby={`${formId}-country-label`} onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = options.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
          options[next]?.focus();
        }}>{supportedCountries.map((item) => <button type="button" key={item.code} role="option" aria-selected={countryCode === item.code} onClick={() => {
          setCountryCode(item.code); setPhoneNumber(""); setOtp(""); setError(""); setCountryMenuOpen(false); countryMenu.current?.querySelector("button")?.focus();
        }}><span>{item.label[language]} ({item.code})</span>{countryCode === item.code && <Check size={16} />}</button>)}</div>}
      </div></div>
      <div className="gg-login-field-group"><label htmlFor={`${formId}-phone`}>{t.phoneNumber}</label>
      <div className="gg-login-phone-row">
        <div className="nm-field gg-login-prefix">{countryCode}</div>
        <div className="gg-login-phone-input">
        <input
          id={`${formId}-phone`}
          type="tel"
          className="nm-field"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneNumber}
          onChange={(event) => {
            setPhoneNumber(event.target.value);
            setError("");
          }}
          placeholder={country.hint}
        />
        {phoneNumber && <button type="button" className="gg-phone-clear" aria-label={language === "en" ? "Clear phone number" : "清除手机号"} onClick={() => { setPhoneNumber(""); setError(""); document.getElementById(`${formId}-phone`)?.focus(); }}><X size={14} /></button>}
        </div>
      </div></div>
      <div className="gg-login-field-group"><label htmlFor={`${formId}-otp`}>{language === "en" ? "Verification code" : "验证码"}</label>
          <div className="gg-login-code-row">
          <input
            id={`${formId}-otp`}
            aria-label={language === "en" ? "Verification code" : "验证码"}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(event) => { setOtp(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
            placeholder={language === "en" ? "6-digit code" : "6 位验证码"}
          />
          <span aria-hidden />
          <button type="button" onClick={() => void requestOtp()} disabled={sending || countdown > 0}>
            {sending ? (language === "en" ? "Sending…" : "发送中…") : countdown > 0 ? `${language === "en" ? "Resend in" : "重新发送"} ${countdown}s` : t.sendOtp}
          </button>
          </div></div>
      {error && <p className="gg-form-message is-error" role="alert">{error}</p>}
      <p className="nm-login-consent">
        {brandText(t.consentPrefix, language)}{" "}
        <Link to="/terms-of-use" target="_blank" rel="noreferrer">
          {t.termsOfUse}
        </Link>{" "}
        {t.consentJoiner}{" "}
        <Link to="/privacy-policy" target="_blank" rel="noreferrer">
          {t.privacyPolicy}
        </Link>
        . {t.consentSuffix}
      </p>
      <Button className="gg-login-submit" type="submit" disabled={signingIn}>
        {signingIn ? (language === "en" ? "Signing in…" : "登录中…") : t.signIn}
      </Button>
    </form>
  );
}
