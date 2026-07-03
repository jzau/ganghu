import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/Button";

const supportedCountries = [
  { label: "China mainland", code: "+86", hint: "138 0013 8000", pattern: /^1\d{10}$/ },
  { label: "Hong Kong", code: "+852", hint: "5123 4567", pattern: /^[23569]\d{7}$/ },
  { label: "Japan", code: "+81", hint: "90 1234 5678", pattern: /^\d{9,10}$/ },
  { label: "Australia", code: "+61", hint: "412 345 678", pattern: /^\d{9}$/ }
] as const;

type CountryCode = (typeof supportedCountries)[number]["code"];

export function LoginPage() {
  const navigate = useNavigate();
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
      setError(`Enter a valid ${country.label} phone number.`);
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
      setError(err instanceof Error ? err.message : "Failed to send OTP");
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
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#dcdde3] p-4 text-[#2a2a2a]">
      <section className="nm-card w-full max-w-sm p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="nm-logo">
            <MessageSquare size={20} />
          </div>
          <div>
            <h1 className="whitespace-nowrap text-lg font-extrabold">GANGHU AI</h1>
            <p className="text-sm text-[#808080]">工夫</p>
          </div>
        </div>
        <label className="mb-2 block text-sm font-bold">Country / region</label>
        <select
          className="nm-field mb-3"
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
              {item.label} ({item.code})
            </option>
          ))}
        </select>
        <label className="mb-2 block text-sm font-bold">Phone number</label>
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
            <label className="mb-2 block text-sm font-bold">OTP sent to {fullPhoneNumber}</label>
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
          {step === "phone" ? "Send OTP" : "Sign in"}
        </Button>
      </section>
    </main>
  );
}
