import type { ApiUser } from "@ai-chat/shared";
import { ArrowLeft, Check, Coins, CreditCard, FileText, Gift, Globe, LogOut, MessageCircle, MessageSquare, ShieldCheck, UserRound, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Language } from "../lib/i18n";
import { Button } from "./Button";

const labels = {
  en: { settings: "Settings", profile: "Profile", credits: "Recharge", tokens: "Redeem", usage: "Usage & Billing", feedback: "Feedback", terms: "Terms of Service", privacy: "Privacy Policy", language: "Language", account: "Account", balance: "Balance & Usage", support: "Support & Legal", preferences: "Preferences", management: "Account Management", logout: "Log out", close: "Close settings", details: "Account details", nickname: "Nickname", phone: "Bound phone", change: "Change", deleteTitle: "Permanently delete this GG account", deleteHint: "This action requires a second confirmation and cannot be undone.", delete: "Delete account", unavailable: "Account editing is not available yet.", unnamed: "Not set", currentTokens: "Current token balance", preview: "UI preview · No payments or account changes", creditBalance: "Current credit balance", choose: "Choose your Credits", chooseHint: "Select a preset or enter another fiat amount.", others: "Others", enterAmount: "Enter amount", method: "Payment method", summary: "Order summary", total: "Total", previewPay: "Preview payment", previewReady: "Payment preview", previewHint: "No payment was processed. Your balance has not changed.", done: "Done", history: "History", sample: "Sample activity for design preview. This is not your billing history.", balanceTab: "Balance", walletTab: "Toking Wallet", legalHint: "Read the current policy in a new tab.", openPolicy: "Open policy", feedbackHint: "Feedback submission is not available yet.", edit: "Edit" },
  zh: { settings: "设置", profile: "个人资料", credits: "充值", tokens: "兑换", usage: "用量与账单", feedback: "反馈", terms: "服务条款", privacy: "隐私政策", language: "语言", account: "账户", balance: "余额与用量", support: "支持与法律", preferences: "偏好设置", management: "账户管理", logout: "退出登录", close: "关闭设置", details: "账户详情", nickname: "昵称", phone: "绑定手机", change: "更换", deleteTitle: "永久删除此 GG 账户", deleteHint: "此操作需要二次确认，且无法撤销。", delete: "删除账户", unavailable: "账户编辑功能暂未开放。", unnamed: "未设置", currentTokens: "当前代币余额", preview: "界面预览 · 不会支付或更改账户", creditBalance: "当前积分余额", choose: "选择充值积分", chooseHint: "选择预设金额或输入其他金额。", others: "其他", enterAmount: "输入金额", method: "支付方式", summary: "订单摘要", total: "总计", previewPay: "预览支付", previewReady: "支付预览", previewHint: "未进行任何支付，您的余额未发生变化。", done: "完成", history: "历史记录", sample: "以下为设计预览示例，并非您的真实账单。", balanceTab: "余额", walletTab: "Toking 钱包", legalHint: "在新标签页阅读当前政策。", openPolicy: "打开政策", feedbackHint: "反馈提交功能暂未开放。", edit: "编辑" }
};
type Section = "profile" | "credits" | "tokens" | "usage" | "feedback" | "terms" | "privacy" | "language";
type Props = { language: Language; onLanguageChange: (language: Language) => void; user: ApiUser; initialSection: Section; onClose: () => void; onLogout: () => void | Promise<void>; redeem: ReactNode };

export function SettingsDialog({ language, onLanguageChange, user, initialSection, onClose, onLogout, redeem }: Props) {
  const t = labels[language];
  const [section, setSection] = useState<Section>(initialSection);
  const [mobilePanel, setMobilePanel] = useState(initialSection === "tokens");
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
            {section === "profile" && <><p className="gg-eyebrow">{t.details}</p><div className="gg-settings-card">
              <div className="gg-profile-row"><div><p>{t.nickname}</p><strong>{user.displayName || t.unnamed}</strong></div><button className="gg-text-action" disabled title={t.unavailable}>{t.edit}</button></div>
              <div className="gg-profile-row"><div><p>{t.phone}</p><strong className="gg-phone">{user.phoneNumber}</strong></div><button className="gg-text-action" disabled title={t.unavailable}>{t.change}</button></div>
              <div className="gg-profile-row"><div><strong>{t.deleteTitle}</strong><p>{t.deleteHint}</p></div><button className="gg-text-action is-danger" disabled title={t.unavailable}>{t.delete}</button></div>
            </div><p className="gg-settings-note">{t.unavailable}</p></>}
            {section === "credits" && <PaymentsPreview language={language} />}
            {section === "tokens" && <><Balance label={t.currentTokens} value={user.appTokenBalance.toLocaleString()} unit="Tokens" /> <div className="gg-redeem-panel">{redeem}</div></>}
            {section === "usage" && <UsagePreview language={language} />}
            {section === "language" && <div className="gg-settings-card">{(["en", "zh"] as const).map((value) => <button className="gg-language-row" key={value} aria-pressed={language === value} onClick={() => onLanguageChange(value)}><span>{value === "en" ? "English" : "简体中文"}</span>{language === value && <Check size={16} />}</button>)}</div>}
            {(section === "terms" || section === "privacy") && <><p className="gg-settings-note">{t.legalHint}</p><a className="gg-text-action" href={section === "terms" ? "/terms-of-use" : "/privacy-policy"} target="_blank" rel="noreferrer">{t.openPolicy}</a></>}
            {section === "feedback" && <p className="gg-settings-note">{t.feedbackHint}</p>}
          </div>
        </section>
      </div>
    </div>, document.body
  );
}

function Balance({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="gg-balance-card"><p>{label}</p><div><strong>{value}</strong><span>{unit}</span></div></div>;
}

function PaymentsPreview({ language }: { language: Language }) {
  const t = labels[language];
  const [amount, setAmount] = useState<number | "other">(1000);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState("WeChat Pay");
  const [preview, setPreview] = useState(false);
  const selected = amount === "other" ? Number(custom) : amount;
  const valid = Number.isSafeInteger(selected) && selected > 0;
  // Reference-only display conversion. No order, balance or payment API is called.
  const total = `¥${(valid ? selected : 0).toFixed(2)}`;
  return <div className="gg-payment-preview">
    <p className="gg-preview-notice">{t.preview}</p>
    <Balance label={t.creditBalance} value="—" unit="Credits" />
    <section><h3 className="gg-eyebrow">{t.choose}</h3><p className="gg-section-hint">{t.chooseHint}</p>
      <div className="gg-credit-options" role="group" aria-label={t.choose}>
        {[500, 1000, 2500, 5000].map((value) => <button className="gg-choice-card" aria-pressed={amount === value} key={value} onClick={() => { setAmount(value); setPreview(false); }}><span>{value.toLocaleString()} <small>Credits</small></span><small>¥{value.toFixed(2)}</small></button>)}
        <button className="gg-choice-card gg-custom-choice" aria-pressed={amount === "other"} onClick={() => { setAmount("other"); setPreview(false); }}><span>{t.others}</span><small>{t.enterAmount}</small></button>
        {amount === "other" && <input className="nm-field gg-custom-input" type="number" min="1" step="1" inputMode="numeric" aria-label={t.enterAmount} placeholder={t.enterAmount} value={custom} onChange={(event) => { setCustom(event.target.value); setPreview(false); }} />}
      </div>
    </section>
    <section><h3 className="gg-eyebrow">{t.method}</h3><div role="group" aria-label={t.method}>{["WeChat Pay", "Ali Pay", "Card"].map((value) => <button className="gg-payment-method" key={value} aria-pressed={method === value} onClick={() => { setMethod(value); setPreview(false); }}>{value === "Card" ? <CreditCard size={21} /> : value === "WeChat Pay" ? <MessageCircle size={21} className="gg-wechat" /> : <span className="gg-alipay">支</span>}<span>{value}</span><span className={`gg-radio ${method === value ? "is-checked" : ""}`} /></button>)}</div></section>
    <section><h3 className="gg-eyebrow">{t.summary}</h3><dl className="gg-order-summary"><div><dt>Credits</dt><dd>{valid ? selected.toLocaleString() : "—"} Credits</dd></div><div><dt>{t.method}</dt><dd>{method}</dd></div><div><dt>{t.total}</dt><dd>{total}</dd></div></dl></section>
    <Button className="w-full" disabled={!valid} onClick={() => setPreview(true)}>{t.previewPay} {total}</Button>
    {preview && <div className="gg-payment-confirmation" role="status"><Check size={18} /><div><strong>{t.previewReady}</strong><p>{t.previewHint}</p></div><button className="gg-text-action" onClick={() => setPreview(false)}>{t.done}</button></div>}
  </div>;
}

const sampleActivity = [
  { id: "credit-1", unit: "Credits", title: "Recharge · Card", titleZh: "充值 · 银行卡", date: "2026-09-01 14:30", delta: 1000 },
  { id: "credit-2", unit: "Credits", title: "Plan a weekend getaway", titleZh: "规划周末旅行", date: "2026-09-01 13:20", delta: -12 },
  { id: "credit-3", unit: "Credits", title: "Explain a complex idea", titleZh: "解释复杂概念", date: "2026-08-31 09:45", delta: -8 },
  { id: "token-1", unit: "Tokens", title: "Gift card redeemed", titleZh: "礼品卡兑换", date: "2026-09-01 10:00", delta: 250000 },
  { id: "token-2", unit: "Tokens", title: "Explore a new topic", titleZh: "探索新话题", date: "2026-08-31 16:15", delta: -2450 }
];
function UsagePreview({ language }: { language: Language }) {
  const t = labels[language];
  const [unit, setUnit] = useState("Credits");
  return <><p className="gg-preview-notice">{t.sample}</p><div className="gg-usage-tabs" role="group" aria-label={t.usage}>{["Credits", "Tokens"].map((value) => <button key={value} aria-pressed={unit === value} onClick={() => setUnit(value)}>{value === "Credits" ? t.balanceTab : t.walletTab}</button>)}</div><p className="gg-eyebrow gg-history-label">{t.history}</p><div className="gg-ledger">{sampleActivity.filter((row) => row.unit === unit).map((row) => <div className="gg-ledger-row" key={row.id}><div><strong>{language === "en" ? row.title : row.titleZh}</strong><p>{row.date}</p></div><div className={row.delta > 0 ? "gg-positive" : ""}><strong>{row.delta > 0 ? "+" : "−"}{Math.abs(row.delta).toLocaleString()}</strong> <small>{row.unit.toLowerCase()}</small></div></div>)}</div></>;
}
