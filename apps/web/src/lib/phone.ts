import { supportedCountries } from "../components/LoginForm";

export function maskPhone(phone: string) {
  const countryCode = [...supportedCountries].sort((a, b) => b.code.length - a.code.length).find((item) => phone.startsWith(item.code))?.code;
  if (!countryCode) return phone;
  const localNumber = phone.slice(countryCode.length);
  return localNumber.length >= 7 ? `${countryCode} ${localNumber.slice(0, 3)} •••• ${localNumber.slice(-4)}` : phone;
}
