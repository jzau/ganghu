import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { languageLabels, localizeErrorMessage, useLanguage } from "../lib/i18n";
import { Button } from "../components/Button";

const supportedCountries = [
  { label: { en: "China mainland", zh: "中国大陆" }, code: "+86", hint: "138 0013 8000", pattern: /^1\d{10}$/ },
  { label: { en: "Hong Kong", zh: "中国香港" }, code: "+852", hint: "5123 4567", pattern: /^[23569]\d{7}$/ },
  { label: { en: "Japan", zh: "日本" }, code: "+81", hint: "90 1234 5678", pattern: /^\d{9,10}$/ },
  { label: { en: "Australia", zh: "澳大利亚" }, code: "+61", hint: "412 345 678", pattern: /^\d{9}$/ }
] as const;

type CountryCode = (typeof supportedCountries)[number]["code"];

const text = {
  en: {
    countryRegion: "Country / region",
    phoneNumber: "Phone number",
    otpSent: "OTP sent to",
    sendOtp: "Send OTP",
    signIn: "Sign in",
    invalidPhone: (country: string) => `Enter a valid ${country} phone number.`,
    failedToSendOtp: "Failed to send OTP",
    loginFailed: "Login failed"
  },
  zh: {
    countryRegion: "国家 / 地区",
    phoneNumber: "手机号",
    otpSent: "验证码已发送至",
    sendOtp: "发送验证码",
    signIn: "登录",
    invalidPhone: (country: string) => `请输入有效的${country}手机号。`,
    failedToSendOtp: "验证码发送失败",
    loginFailed: "登录失败"
  }
} as const;

export function LoginPage() {
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguage();
  const t = text[language];
  const [countryCode, setCountryCode] = useState<CountryCode>("+86");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");

  const country = supportedCountries.find((item) => item.code === countryCode) ?? supportedCountries[0];
  const localPhoneNumber = phoneNumber.replace(/\D/g, "");
  const fullPhoneNumber = `${countryCode}${localPhoneNumber}`;

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

    try {
      await api("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ countryCode, phoneNumber: localPhoneNumber, otp })
      });
      navigate("/");
    } catch (err) {
      setError(localizeErrorMessage(err, language, t.loginFailed));
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#dcdde3] p-4 text-[#2a2a2a]">
      <section className="nm-card w-full max-w-sm p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="nm-logo nm-logo-mark">
            <span aria-hidden="true">⏳</span>
          </div>
          <div className="nm-brand-wordmark">
            <h1 className={`nm-brand-title ${language === "zh" ? "is-zh" : "is-en"}`}>
              {language === "zh" ? "工夫AI" : "GANGHU AI"}
            </h1>
          </div>
          <button className="nm-login-language ml-auto" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>
            {languageLabels[language === "en" ? "zh" : "en"]}
          </button>
        </div>
        <label className="mb-2 block text-sm font-bold">{t.countryRegion}</label>
        <div className="nm-select-wrap mb-3">
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
        <label className="mb-2 block text-sm font-bold">{t.phoneNumber}</label>
        <div className="mb-3 flex gap-2">
          <div className="nm-field flex w-20 shrink-0 items-center justify-center px-0 text-sm font-bold">{countryCode}</div>
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
            <label className="mb-2 block text-sm font-bold">{t.otpSent} {fullPhoneNumber}</label>
            <input
              className="nm-field mb-3"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              placeholder="000000"
            />
          </>
        )}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={step === "phone" ? requestOtp : verifyOtp}>
          {step === "phone" ? t.sendOtp : t.signIn}
        </Button>
      </section>
    </main>
  );
}
