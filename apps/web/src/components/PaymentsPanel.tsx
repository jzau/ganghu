import type { ApiUser, PaymentCatalogDto, PaymentOrderDto } from "@ai-chat/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Language } from "../lib/i18n";
import { Button } from "./Button";

const copy = {
  en: {
    balance: "Current token balance", tokens: "Tokens", choose: "Choose a recharge", method: "Payment method",
    total: "Total", pay: "Create payment", open: "Continue to payment", unavailable: "Recharge is not available yet.",
    loading: "Loading…", failed: "Could not connect. Please try again.", history: "Recent recharge orders", empty: "No recharge orders yet.",
    check: "Check status", unknown: "Payment creation could not be confirmed. Contact support with the order ID before trying another payment.",
    pending: "Waiting for payment", captured: "Payment confirmed · tokens added", canceled: "Canceled or expired",
    refunded: "Refunded", refund_review: "Refund requires support review", creating: "Creating payment…", creation_unknown: "Needs verification",
    hint: "Your balance updates after payment is verified. You can reopen this screen to check an order.",
    omi: "OmiPay converts this USD amount to CNY, including its exchange-rate buffer. Review the final CNY total before paying.",
    retry: "Retry request", unknownError: "Payment status could not be verified. Your order is saved; check again shortly."
  },
  zh: {
    balance: "当前代币余额", tokens: "代币", choose: "选择充值套餐", method: "支付方式", total: "总计", pay: "创建支付订单",
    open: "继续支付", unavailable: "充值暂未开放。", loading: "加载中…", failed: "连接失败，请重试。", history: "近期充值订单", empty: "暂无充值订单。",
    check: "查询状态", unknown: "无法确认支付订单是否已创建。请先提供订单号联系客服，再尝试其他支付。",
    pending: "等待支付", captured: "支付已确认 · 代币已到账", canceled: "已取消或过期", refunded: "已退款", refund_review: "退款需客服审核",
    creating: "正在创建支付…", creation_unknown: "待核实", hint: "支付核实后余额自动更新。您可重新打开此页面查询订单。",
    omi: "OmiPay 会将此美元金额转换为人民币，并包含汇率缓冲。请在付款前核对最终人民币金额。",
    retry: "重试请求", unknownError: "暂时无法核实支付状态。订单已保存，请稍后查询。"
  }
};

function money(amountMinor: number, currency: string, language: Language) {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { style: "currency", currency, currencyDisplay: "code" }).format(amountMinor / 100);
}

export function PaymentsPanel({ language, user }: { language: Language; user: ApiUser }) {
  const t = copy[language];
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: ["payment-catalog", user.id], queryFn: () => api<PaymentCatalogDto>("/api/payments/catalog") });
  const orders = useQuery({
    queryKey: ["payment-orders", user.id], queryFn: () => api<{ orders: PaymentOrderDto[] }>("/api/payments/orders"),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.orders.some((o) => o.status === "creating") ? 10_000 : false
  });
  const [offerId, setOfferId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshing = useRef(false);
  const creating = useRef(false);
  const history = useRef<HTMLElement>(null);
  const requestKey = useRef<{ offerId: string; methodId: string; requestKey: string } | null>(null);
  const offer = catalog.data?.offers.find((o) => o.id === offerId) ?? catalog.data?.offers[0];
  const methods = catalog.data?.methods.filter((m) => offer && m.currencies.includes(offer.currency)) ?? [];
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  function updateOrder(order: PaymentOrderDto) {
    client.setQueryData<{ orders: PaymentOrderDto[] }>(["payment-orders", user.id], (old) => ({
      orders: [order, ...(old?.orders.filter((o) => o.id !== order.id) ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    }));
    void client.invalidateQueries({ queryKey: ["me"] });
    void client.invalidateQueries({ queryKey: ["payment-ledger", user.id] });
  }

  async function refresh(id: string) {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const result = await api<{ order: PaymentOrderDto }>(`/api/payments/orders/${encodeURIComponent(id)}/refresh`, { method: "POST" });
      updateOrder(result.order); setError("");
    } catch { setError(t.unknownError); }
    finally { refreshing.current = false; }
  }

  // Poll one pending order at a time while visible, and recover after returning from checkout.
  const pendingIds = (orders.data?.orders ?? []).filter((o) => o.status === "pending").map((o) => o.id).join(",");
  useEffect(() => {
    const ids = pendingIds.split(",").filter(Boolean);
    if (!ids.length) return;
    let index = 0;
    const tick = () => { if (document.visibilityState === "visible") void refresh(ids[index++ % ids.length]); };
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, [pendingIds, user.id, language]);

  async function create() {
    if (!offer || !method || creating.current) return;
    creating.current = true; setBusy(true); setError("");
    try {
      const storageKey = `chatbot-payment-request:${user.id}`;
      if (!requestKey.current) {
        try { requestKey.current = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { /* storage may be unavailable */ }
      }
      if (requestKey.current?.offerId !== offer.id || requestKey.current?.methodId !== method.id) {
        requestKey.current = { offerId: offer.id, methodId: method.id, requestKey: crypto.randomUUID() };
      }
      try { sessionStorage.setItem(storageKey, JSON.stringify(requestKey.current)); } catch { /* in-memory retry key remains */ }
      const result = await api<{ order: PaymentOrderDto }>("/api/payments/orders", { method: "POST", body: JSON.stringify(requestKey.current) });
      updateOrder(result.order);
      window.requestAnimationFrame(() => history.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      // Keep the key for ambiguous creation; a retry must not create another gateway order.
      if (!["creating", "creation_unknown"].includes(result.order.status)) {
        requestKey.current = null;
        try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ }
      }
    } catch { setError(t.failed); }
    finally { creating.current = false; setBusy(false); }
  }

  return <div className="gg-payment-preview">
    <div className="gg-balance-card"><p>{t.balance}</p><div><strong>{user.appTokenBalance.toLocaleString()}</strong><span>{t.tokens}</span></div></div>
    {catalog.isPending && <p role="status">{t.loading}</p>}
    {catalog.isError && <p role="alert">{t.failed} <button className="gg-text-action" onClick={() => void catalog.refetch()}>{t.retry}</button></p>}
    {catalog.data && !catalog.data.enabled && <p className="gg-section-hint">{t.unavailable}</p>}
    {catalog.data?.enabled && offer && <>
      <section><h3 className="gg-eyebrow">{t.choose}</h3><div className="gg-credit-options">
        {catalog.data.offers.map((o) => <button disabled={busy} key={o.id} className="gg-choice-card" aria-pressed={offer.id === o.id} onClick={() => setOfferId(o.id)}><span>{o.appTokenAmount.toLocaleString()} <small>{t.tokens}</small></span><small>{money(o.amountMinor, o.currency, language)}</small></button>)}
      </div></section>
      <section><h3 className="gg-eyebrow">{t.method}</h3>{methods.map((m) => <button disabled={busy} key={m.id} className="gg-payment-method" aria-pressed={method?.id === m.id} onClick={() => setMethodId(m.id)}><span>{language === "zh" ? m.labelZh : m.label}</span><span className={`gg-radio ${method?.id === m.id ? "is-checked" : ""}`} /></button>)}</section>
      <dl className="gg-order-summary"><div><dt>{t.tokens}</dt><dd>{offer.appTokenAmount.toLocaleString()}</dd></div><div><dt>{t.total}</dt><dd>{money(offer.amountMinor, offer.currency, language)}</dd></div></dl>
      {method?.provider === "omipay" && <p className="gg-section-hint">{t.omi}</p>}
      <Button className="w-full" disabled={busy || !method} onClick={() => void create()}>{busy ? t.creating : t.pay}</Button>
      <p className="gg-section-hint">{t.hint}</p>
    </>}
    {error && <p role="alert" className="gg-form-message is-error">{error}</p>}
    <section ref={history}><h3 className="gg-eyebrow">{t.history}</h3>
      {orders.isPending && <p>{t.loading}</p>}
      {orders.isError && <p role="alert">{t.failed} <button className="gg-text-action" onClick={() => void orders.refetch()}>{t.retry}</button></p>}
      {orders.data?.orders.length === 0 && <p className="gg-section-hint">{t.empty}</p>}
      {orders.data?.orders.map((order) => <div key={order.id} className="gg-action-card">
        <strong>{order.appTokenAmount.toLocaleString()} {t.tokens} · {money(order.amountMinor, order.currency, language)}</strong>
        <p role="status">{t[order.status as keyof typeof t] ?? order.status}</p>
        <p className="gg-section-hint">{new Date(order.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}<br /><span style={{ overflowWrap: "anywhere" }}>{order.id}</span></p>
        {["creation_unknown", "creating"].includes(order.status) && <p>{t.unknown}</p>}
        <div className="gg-form-actions">
          {order.status === "pending" && order.approvalUrl && <a className="gg-text-action" href={order.approvalUrl} target="_blank" rel="noopener noreferrer">{t.open}</a>}
          {!["creation_unknown", "creating", "refunded", "refund_review"].includes(order.status) && <button className="gg-text-action" onClick={() => void refresh(order.id)}>{t.check}</button>}
        </div>
      </div>)}
    </section>
  </div>;
}

interface LedgerRow { id: string; type: string; amount: number; balanceAfter: number; createdAt: string }
export function PaymentUsagePanel({ language, userId }: { language: Language; userId: string }) {
  const ledger = useQuery({ queryKey: ["payment-ledger", userId], queryFn: () => api<{ entries: LedgerRow[] }>("/api/payments/ledger") });
  const t = copy[language];
  const names: Record<string, string> = language === "zh" ? { payment: "充值", redeem: "兑换", chat_usage: "聊天用量", admin_adjustment: "余额调整", refund: "退还" } : { payment: "Recharge", redeem: "Redeemed", chat_usage: "Chat usage", admin_adjustment: "Balance adjustment", refund: "Refund" };
  return <>
    <p className="gg-eyebrow">{language === "zh" ? "近期代币账单（最多100条）" : "Recent token activity (up to 100 entries)"}</p>
    {ledger.isPending && <p>{t.loading}</p>}
    {ledger.isError && <p role="alert">{t.failed} <button className="gg-text-action" onClick={() => void ledger.refetch()}>{t.retry}</button></p>}
    {ledger.data?.entries.length === 0 && <p>{language === "zh" ? "暂无记录。" : "No activity yet."}</p>}
    <div className="gg-ledger">{ledger.data?.entries.map((row) => <div className="gg-ledger-row" key={row.id}><div><strong>{names[row.type] ?? row.type}</strong><p>{new Date(row.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</p></div><div className={row.amount > 0 ? "gg-positive" : ""}><strong>{row.amount > 0 ? "+" : ""}{row.amount.toLocaleString()}</strong> <small>{t.tokens}</small></div></div>)}</div>
  </>;
}
