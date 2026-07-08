import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { localizeErrorMessage, type Language } from "../lib/i18n";
import { Button } from "./Button";

const supportedCountries = [
  { label: { en: "China mainland", zh: "中国大陆" }, code: "+86", hint: "13800138000", pattern: /^1\d{10}$/ },
  { label: { en: "Hong Kong", zh: "中国香港" }, code: "+852", hint: "51234567", pattern: /^[23569]\d{7}$/ },
  { label: { en: "Japan", zh: "日本" }, code: "+81", hint: "9012345678", pattern: /^\d{9,10}$/ },
  { label: { en: "Australia", zh: "澳大利亚" }, code: "+61", hint: "412345678", pattern: /^\d{9}$/ }
] as const;

type CountryCode = (typeof supportedCountries)[number]["code"];

const loginText = {
  en: {
    countryRegion: "Country / region",
    phoneNumber: "Phone number",
    otpSent: "OTP sent to",
    sendOtp: "Send OTP",
    signIn: "Sign in",
    invalidPhone: (country: string) => `Enter a valid ${country} phone number.`,
    invalidOtp: "Enter the verification code.",
    failedToSendOtp: "Failed to send OTP",
    loginFailed: "Login failed",
    consentPrefix: "By signing up or logging in, you consent to GANGHU AI's",
    termsOfUse: "Terms of Use",
    privacyPolicy: "Privacy Policy",
    consentJoiner: "and",
    consentSuffix: "New phone numbers will be automatically registered."
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
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");

  const country = supportedCountries.find((item) => item.code === countryCode) ?? supportedCountries[0];
  const localPhoneNumber = phoneNumber.replace(/\D/g, "");
  const fullPhoneNumber = `${countryCode}${localPhoneNumber}`;

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "phone") {
      void requestOtp();
    } else {
      void verifyOtp();
    }
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
      await api("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ countryCode, phoneNumber: localPhoneNumber })
      });
      setStep("otp");
    } catch (err) {
      setError(localizeErrorMessage(err, language, t.failedToSendOtp));
    }
  }

  async function verifyOtp() {
    setError("");
    if (!validatePhoneNumber()) return;
    if (otp.trim().length < 4) {
      setError(t.invalidOtp);
      return;
    }

    try {
      await api("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ countryCode, phoneNumber: localPhoneNumber, otp: otp.trim() })
      });
      onSuccess();
    } catch (err) {
      setError(localizeErrorMessage(err, language, t.loginFailed));
    }
  }

  return (
    <form onSubmit={submitLogin}>
      {header}
      <label className="mb-2 block text-[12.5px] font-medium">{t.countryRegion}</label>
      <div className="nm-select-wrap mb-5">
        <select
          className="nm-field nm-select-field"
          value={countryCode}
          onChange={(event) => {
            setCountryCode(event.target.value as CountryCode);
            setPhoneNumber("");
            setStep("phone");
            setOtp("");
            setError("");
          }}
        >
          {supportedCountries.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label[language]} ({item.code})
            </option>
          ))}
        </select>
        <ChevronDown className="nm-select-chevron" size={18} aria-hidden="true" />
      </div>
      <label className="mb-2 block text-[12.5px] font-medium">{t.phoneNumber}</label>
      <div className="mb-5 flex gap-2">
        <div className="nm-field flex w-20 shrink-0 items-center justify-center px-0 text-[12.5px] font-medium">{countryCode}</div>
        <input
          className="nm-field"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneNumber}
          onChange={(event) => {
            setPhoneNumber(event.target.value);
            setStep("phone");
            setOtp("");
            setError("");
          }}
          placeholder={country.hint}
        />
      </div>
      {step === "otp" && (
        <>
          <label className="mb-2 block text-[12.5px] font-medium">{t.otpSent} {fullPhoneNumber}</label>
          <input
            className="nm-field mb-5"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            placeholder="000000"
          />
        </>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <p className="nm-login-consent">
        {t.consentPrefix}{" "}
        <Link to="/terms-of-use" target="_blank" rel="noreferrer">
          {t.termsOfUse}
        </Link>{" "}
        {t.consentJoiner}{" "}
        <Link to="/privacy-policy" target="_blank" rel="noreferrer">
          {t.privacyPolicy}
        </Link>
        . {t.consentSuffix}
      </p>
      <Button className="w-full !text-[12.5px] !font-medium" type="submit">
        {step === "phone" ? t.sendOtp : t.signIn}
      </Button>
    </form>
  );
}
