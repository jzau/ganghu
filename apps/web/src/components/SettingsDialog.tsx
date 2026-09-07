import { PaymentsPanel, PaymentUsagePanel } from "./PaymentsPanel";
import type { ApiUser } from "@ai-chat/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Coins, FileText, Gift, Globe, LogOut, MessageSquare, ShieldCheck, UserRound, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { localizeErrorMessage, type Language } from "../lib/i18n";
import { Button } from "./Button";
import { supportedCountries, type CountryCode } from "./LoginForm";
import { LegalContent } from "../pages/LegalPage";

const labels = {
  en: { settings: "Settings", profile: "Profile", credits: "Recharge", tokens: "Redeem", usage: "Usage & Billing", feedback: "Feedback", terms: "Terms of Service", privacy: "Privacy Policy", language: "Language", account: "Account", balance: "Balance & Usage", support: "Support & Legal", preferences: "Preferences", management: "Account Management", logout: "Log out", close: "Close settings", details: "Account details", nickname: "Nickname", phone: "Bound phone", change: "Change", deleteTitle: "Permanently delete this GG account", deleteHint: "This action requires a second confirmation and cannot be undone.", delete: "Delete account", unavailable: "Account editing is not available yet.", unnamed: "Not set", currentTokens: "Current token balance", preview: "UI preview · No payments or account changes", creditBalance: "Current credit balance", choose: "Choose your Credits", chooseHint: "Select a preset or enter another fiat amount.", others: "Others", enterAmount: "Enter amount", method: "Payment method", summary: "Order summary", total: "Total", previewPay: "Preview payment", previewReady: "Payment preview", previewHint: "No payment was processed. Your balance has not changed.", done: "Done", history: "History", sample: "Sample activity for design preview. This is not your billing history.", balanceTab: "Balance", walletTab: "Toking Wallet", legalHint: "Read the current policy in a new tab.", openPolicy: "Open policy", feedbackHint: "Feedback submission is not available yet.", edit: "Edit" },
  zh: { settings: "设置", profile: "个人资料", credits: "充值", tokens: "兑换", usage: "用量与账单", feedback: "反馈", terms: "服务条款", privacy: "隐私政策", language: "语言", account: "账户", balance: "余额与用量", support: "支持与法律", preferences: "偏好设置", management: "账户管理", logout: "退出登录", close: "关闭设置", details: "账户详情", nickname: "昵称", phone: "绑定手机", change: "更换", deleteTitle: "永久删除此 GG 账户", deleteHint: "此操作需要二次确认，且无法撤销。", delete: "删除账户", unavailable: "账户编辑功能暂未开放。", unnamed: "未设置", currentTokens: "当前代币余额", preview: "界面预览 · 不会支付或更改账户", creditBalance: "当前积分余额", choose: "选择充值积分", chooseHint: "选择预设金额或输入其他金额。", others: "其他", enterAmount: "输入金额", method: "支付方式", summary: "订单摘要", total: "总计", previewPay: "预览支付", previewReady: "支付预览", previewHint: "未进行任何支付，您的余额未发生变化。", done: "完成", history: "历史记录", sample: "以下为设计预览示例，并非您的真实账单。", balanceTab: "余额", walletTab: "Toking 钱包", legalHint: "在新标签页阅读当前政策。", openPolicy: "打开政策", feedbackHint: "反馈提交功能暂未开放。", edit: "编辑" }
};
type Section = "profile" | "credits" | "tokens" | "usage" | "feedback" | "terms" | "privacy" | "language";
type Props = { language: Language; onLanguageChange: (language: Language) => void; user: ApiUser; initialSection: Section; onClose: () => void; onLogout: () => void | Promise<void>; onAccountDeleted: () => void; redeem: ReactNode };

export function SettingsDialog({ language, onLanguageChange, user, initialSection, onClose, onLogout, onAccountDeleted, redeem }: Props) {
  const t = labels[language];
  const [section, setSection] = useState<Section>(initialSection);
  const [mobilePanel, setMobilePanel] = useState(initialSection !== "profile");
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select,[tabindex="0"]') ?? []).filter((el) => el.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  const groups = [
    { name: t.account, items: [{ id: "profile", icon: UserRound }] },
    { name: t.balance, items: [{ id: "credits", icon: Coins }, { id: "tokens", icon: Gift }, { id: "usage", icon: Wallet }] },
    { name: t.support, items: [{ id: "feedback", icon: MessageSquare }, { id: "terms", icon: FileText }, { id: "privacy", icon: ShieldCheck }] },
    { name: t.preferences, items: [{ id: "language", icon: Globe }] }
  ] as const;
  return createPortal(
    <div className="gg-settings-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`gg-settings ${mobilePanel ? "is-panel-open" : ""}`} role="dialog" aria-modal="true" aria-label={t.settings} tabIndex={-1} ref={dialog}>
        <nav className="gg-settings-nav" aria-label={t.settings}>
          <h1>{t.settings}</h1>
          <button className="gg-settings-mobile-close nm-icon-button" onClick={onClose} aria-label={t.close}><X size={18} /></button>
          <div className="gg-settings-nav-scroll">
            {groups.map((group) => <div className="gg-settings-group" key={group.name}>
              <p className="gg-eyebrow">{group.name}</p>
              {group.items.map(({ id, icon: Icon }) => <button key={id} aria-current={section === id ? "page" : undefined} className={`gg-settings-nav-item ${section === id ? "is-active" : ""}`} onClick={() => { setSection(id); setMobilePanel(true); }}><Icon size={16} /><span>{t[id]}</span></button>)}
            </div>)}
            <div className="gg-settings-group"><p className="gg-eyebrow">{t.management}</p><button className="gg-settings-nav-item" onClick={() => void onLogout()}><LogOut size={16} />{t.logout}</button></div>
          </div>
        </nav>
        <section className="gg-settings-pane">
          <header className="gg-settings-heading">
            <button className="gg-settings-back nm-icon-button" onClick={() => setMobilePanel(false)} aria-label={t.settings}><ArrowLeft size={18} /></button>
            <h2>{t[section]}</h2>
            <button className="nm-icon-button" onClick={onClose} aria-label={t.close}><X size={18} /></button>
          </header>
          <div className="gg-settings-content" key={section}>
            {section === "profile" && <ProfilePanel language={language} user={user} onAccountDeleted={onAccountDeleted} />}
            {section === "credits" && <PaymentsPanel language={language} user={user} />}
            {section === "tokens" && <><Balance label={t.currentTokens} value={user.appTokenBalance.toLocaleString()} unit="Tokens" /> <div className="gg-redeem-panel">{redeem}</div></>}
            {section === "usage" && <PaymentUsagePanel language={language} userId={user.id} />}
            {section === "language" && <div className="gg-settings-card">{(["en", "zh"] as const).map((value) => <button className="gg-language-row" key={value} aria-pressed={language === value} onClick={() => onLanguageChange(value)}><span>{value === "en" ? "English" : "简体中文"}</span>{language === value && <Check size={16} />}</button>)}</div>}
            {(section === "terms" || section === "privacy") && <LegalContent kind={section} language={language} />}
            {section === "feedback" && <FeedbackPanel language={language} />}
          </div>
        </section>
      </div>
    </div>, document.body
  );
}

const profileText = {
  en: { details: "Account details", nickname: "Nickname", phone: "Bound phone", unnamed: "Not set", edit: "Edit", change: "Change", deleteTitle: "Permanently delete this GG account", deleteHint: "Your conversations, balance and account data will be deleted.", delete: "Delete account", save: "Save", cancel: "Cancel", newPhone: "New phone number", send: "Send verification code", code: "Verification code", verify: "Verify and change", sent: "A verification code was sent to the new number.", updated: "Phone number updated.", nameUpdated: "Nickname updated.", confirmTitle: "Delete your account?", confirmHint: "This cannot be undone. Type DELETE to confirm.", confirm: "Delete permanently", failed: "Could not update your account", deleteFailed: "Could not delete your account" },
  zh: { details: "账户详情", nickname: "昵称", phone: "绑定手机", unnamed: "未设置", edit: "编辑", change: "更换", deleteTitle: "永久删除此 GG 账户", deleteHint: "您的对话、余额及账户资料将被删除。", delete: "删除账户", save: "保存", cancel: "取消", newPhone: "新手机号", send: "发送验证码", code: "验证码", verify: "验证并更换", sent: "验证码已发送至新手机号。", updated: "手机号已更新。", nameUpdated: "昵称已更新。", confirmTitle: "删除账户？", confirmHint: "此操作无法撤销。请输入 DELETE 以确认。", confirm: "永久删除", failed: "无法更新账户", deleteFailed: "无法删除账户" }
} as const;

function ProfilePanel({ language, user, onAccountDeleted }: { language: Language; user: ApiUser; onAccountDeleted: () => void }) {
  const t = profileText[language];
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"main" | "name" | "phone" | "delete">("main");
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [countryCode, setCountryCode] = useState<CountryCode>("+86");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState<"phone" | "otp">("phone");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const country = supportedCountries.find((item) => item.code === countryCode) ?? supportedCountries[0];
  const localPhone = phoneNumber.replace(/\D/g, "");

  function updateCachedUser(nextUser: ApiUser) {
    queryClient.setQueryData<{ user: ApiUser }>(["me"], { user: nextUser });
  }
  function reset(nextMode: typeof mode = "main") {
    setMode(nextMode); setError(""); setMessage(""); setOtp(""); setPhoneStep("phone"); setConfirmation("");
  }
  async function saveName(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const result = await api<{ user: ApiUser }>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName: displayName.trim() || null }) });
      updateCachedUser(result.user); setMessage(t.nameUpdated); setMode("main");
    } catch (err) { setError(localizeErrorMessage(err, language, t.failed)); }
    finally { setPending(false); }
  }
  async function submitPhone(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    try {
      if (phoneStep === "phone") {
        if (!country.pattern.test(localPhone)) throw new Error(language === "en" ? "Enter a valid phone number" : "请输入有效手机号");
        await api("/api/auth/phone-change/otp/request", { method: "POST", body: JSON.stringify({ countryCode, phoneNumber: localPhone }) });
        setPhoneStep("otp"); setMessage(t.sent);
      } else {
        const result = await api<{ user: ApiUser }>("/api/auth/phone-change/otp/verify", { method: "POST", body: JSON.stringify({ countryCode, phoneNumber: localPhone, otp: otp.trim() }) });
        updateCachedUser(result.user); setMessage(t.updated); setMode("main"); setPhoneNumber(""); setOtp(""); setPhoneStep("phone");
      }
    } catch (err) { setError(localizeErrorMessage(err, language, t.failed)); }
    finally { setPending(false); }
  }
  async function deleteAccount() {
    if (confirmation !== "DELETE") return;
    setPending(true); setError("");
    try { await api("/api/me", { method: "DELETE" }); onAccountDeleted(); }
    catch (err) { setError(localizeErrorMessage(err, language, t.deleteFailed)); setPending(false); }
  }

  return <>
    <p className="gg-eyebrow">{t.details}</p>
    {mode === "main" && <div className="gg-settings-card">
      <div className="gg-profile-row"><div><p>{t.nickname}</p><strong>{user.displayName || t.unnamed}</strong></div><button className="gg-text-action" onClick={() => reset("name")}>{t.edit}</button></div>
      <div className="gg-profile-row"><div><p>{t.phone}</p><strong className="gg-phone">{user.phoneNumber}</strong></div><button className="gg-text-action" onClick={() => reset("phone")}>{t.change}</button></div>
      <div className="gg-profile-row"><div><strong>{t.deleteTitle}</strong><p>{t.deleteHint}</p></div><button className="gg-text-action is-danger" onClick={() => reset("delete")}>{t.delete}</button></div>
    </div>}
    {mode === "name" && <form className="gg-action-card" onSubmit={saveName}><label>{t.nickname}<input className="nm-field" value={displayName} maxLength={60} autoFocus onChange={(event) => setDisplayName(event.target.value)} /></label><div className="gg-form-actions"><Button type="button" variant="ghost" onClick={() => reset()}>{t.cancel}</Button><Button disabled={pending}>{t.save}</Button></div></form>}
    {mode === "phone" && <form className="gg-action-card" onSubmit={submitPhone}><label>{t.newPhone}</label><div className="gg-phone-fields"><select className="nm-field" value={countryCode} onChange={(event) => { setCountryCode(event.target.value as CountryCode); setPhoneStep("phone"); setOtp(""); }} disabled={phoneStep === "otp"}>{countryCodeOptions(language)}</select><input className="nm-field" inputMode="tel" value={phoneNumber} placeholder={country.hint} onChange={(event) => { setPhoneNumber(event.target.value); setPhoneStep("phone"); setOtp(""); }} /></div>{phoneStep === "otp" && <label>{t.code}<input className="nm-field" inputMode="numeric" autoComplete="one-time-code" value={otp} autoFocus onChange={(event) => setOtp(event.target.value)} /></label>}<div className="gg-form-actions"><Button type="button" variant="ghost" onClick={() => reset()}>{t.cancel}</Button><Button disabled={pending || (phoneStep === "otp" && otp.trim().length < 4)}>{phoneStep === "phone" ? t.send : t.verify}</Button></div></form>}
    {mode === "delete" && <div className="gg-action-card is-danger"><h3>{t.confirmTitle}</h3><p>{t.confirmHint}</p><input className="nm-field" value={confirmation} autoFocus autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} placeholder="DELETE" /><div className="gg-form-actions"><Button type="button" variant="ghost" onClick={() => reset()}>{t.cancel}</Button><Button type="button" className="gg-delete-button" disabled={pending || confirmation !== "DELETE"} onClick={() => void deleteAccount()}>{t.confirm}</Button></div></div>}
    {message && <p className="gg-form-message is-success" role="status">{message}</p>}{error && <p className="gg-form-message is-error" role="alert">{error}</p>}
  </>;
}

function countryCodeOptions(language: Language) {
  return supportedCountries.map((item) => <option key={item.code} value={item.code}>{item.label[language]} ({item.code})</option>);
}

function FeedbackPanel({ language }: { language: Language }) {
  return <div className="gg-feedback-panel"><p>{language === "en" ? "Something not working, or a suggestion on your mind? Email us directly — every message reaches the team." : "遇到问题或有任何建议？欢迎直接发送邮件，每一封邮件都会由团队查看。"}</p><p className="gg-eyebrow">{language === "en" ? "Contact us" : "联系我们"}</p><a className="gg-text-action" href="mailto:support@gangram.com">support@gangram.com</a></div>;
}

function Balance({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="gg-balance-card"><p>{label}</p><div><strong>{value}</strong><span>{unit}</span></div></div>;
}
