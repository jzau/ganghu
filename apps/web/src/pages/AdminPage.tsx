import type { ApiUser, LlmModelDto } from "@ai-chat/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, ChevronDown, Copy, Database, LogOut, Menu, Pencil, Plus, Save, Search, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";

type AdminSection = "users" | "redeem-codes" | "models" | "settings";
type SearchProvider = "tavily" | "aliyun-iqs";
type SearchSettings = {
  provider: SearchProvider;
  configured: Record<SearchProvider, boolean>;
};

type AdminRedeemCode = {
  id: string;
  code: string | null;
  appTokenAmount: number;
  usageLimit: number | null;
  usedCount: number;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  redemptions: Array<{
    id: string;
    appTokenAmount: number;
    createdAt: string;
    user: ApiUser;
  }>;
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [authState, setAuthState] = useState<"checking" | "authed" | "guest">("checking");
  const [section, setSection] = useState<AdminSection>("users");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const authed = authState === "authed";

  const models = useQuery({ queryKey: ["admin-models"], queryFn: () => api<{ models: LlmModelDto[] }>("/api/admin/models"), enabled: authed });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<{ users: ApiUser[] }>("/api/admin/users"), enabled: authed });
  const codes = useQuery({ queryKey: ["admin-codes"], queryFn: () => api<{ codes: AdminRedeemCode[] }>("/api/admin/redeem-codes"), enabled: authed });
  const searchSettings = useQuery({
    queryKey: ["admin-search-settings"],
    queryFn: () => api<SearchSettings>("/api/admin/settings/search"),
    enabled: authed
  });

  useEffect(() => {
    let active = true;
    api<{ ok: true }>("/api/admin/me")
      .then(() => {
        if (active) setAuthState("authed");
      })
      .catch(() => {
        if (active) setAuthState("guest");
      });
    return () => {
      active = false;
    };
  }, []);

  async function login() {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
    setPassword("");
    setAuthState("authed");
  }

  async function logout() {
    await api("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    queryClient.removeQueries({ queryKey: ["admin-models"] });
    queryClient.removeQueries({ queryKey: ["admin-users"] });
    queryClient.removeQueries({ queryKey: ["admin-codes"] });
    queryClient.removeQueries({ queryKey: ["admin-search-settings"] });
    setAuthState("guest");
  }

  function selectSection(nextSection: AdminSection) {
    setSection(nextSection);
    setSidebarOpen(false);
  }

  const sectionTitle = section === "users"
    ? "Users"
    : section === "redeem-codes"
      ? "Redeem Codes"
      : section === "models" ? "Models" : "Settings";

  if (authState === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#dcdde3] p-4 text-[#2a2a2a]">
        <section className="nm-card p-5 text-sm font-extrabold text-[#808080]">Checking admin session...</section>
      </main>
    );
  }

  if (authState === "guest") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#dcdde3] p-4 text-[#2a2a2a]">
        <section className="nm-card w-full max-w-sm p-5">
          <h1 className="mb-4 text-lg font-extrabold">Admin</h1>
          <input
            className="nm-field mb-3"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void login();
            }}
            placeholder="Password"
          />
          <Button className="w-full" onClick={login}>Sign in</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="nm-page nm-chat-page">
      <div className="nm-shell">
        <div className="nm-layout">
          {sidebarOpen && <button className="nm-drawer-scrim md:hidden" aria-label="Close admin navigation" onClick={() => setSidebarOpen(false)} />}
          <aside className={`nm-sidebar ${sidebarOpen ? "is-open" : ""}`}>
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1a1a1a] text-[#ececec] shadow-nm-out">
                <Database size={19} />
              </div>
              <div>
                <h1 className="text-base font-extrabold">Admin Dashboard</h1>
                <p className="text-xs font-semibold text-[#808080]">Operations</p>
              </div>
            </div>

            <nav className="space-y-2">
              <SidebarButton active={section === "users"} count={users.data?.users.length ?? 0} icon={<Users size={17} />} label="Users" onClick={() => selectSection("users")} />
              <SidebarButton active={section === "redeem-codes"} count={codes.data?.codes.length ?? 0} icon={<Ticket size={17} />} label="Redeem Codes" onClick={() => selectSection("redeem-codes")} />
              <SidebarButton active={section === "models"} count={models.data?.models.length ?? 0} icon={<Bot size={17} />} label="Models" onClick={() => selectSection("models")} />
              <SidebarButton active={section === "settings"} icon={<Search size={17} />} label="Search Settings" onClick={() => selectSection("settings")} />
            </nav>

            <Button className="mt-auto w-full justify-start" variant="secondary" onClick={() => void logout()}>
              <LogOut size={16} /> Logout
            </Button>
          </aside>

          <section className="nm-chat nm-admin-main">
            <header className="nm-admin-mobile-header md:hidden">
              <button className="nm-icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open admin navigation">
                <Menu size={18} />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold">Admin Dashboard</div>
                <div className="truncate text-xs font-semibold text-[#808080]">{sectionTitle}</div>
              </div>
            </header>
            <div className="nm-admin-content">
              {section === "users" && <UsersTable users={users.data?.users ?? []} />}
              {section === "redeem-codes" && <RedeemCodesTable codes={codes.data?.codes ?? []} />}
              {section === "models" && <ModelsTable models={models.data?.models ?? []} />}
              {section === "settings" && <SearchSettingsPanel settings={searchSettings.data} />}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SidebarButton({ active, count, icon, label, onClick }: { active: boolean; count?: number; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`focus-ring flex h-12 w-full items-center justify-between rounded-xl border-0 bg-[#ececec] px-3 text-left transition ${active ? "shadow-nm-in" : "shadow-nm-out hover:brightness-[1.02]"}`}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-sm font-extrabold">{label}</span>
      </span>
      {count !== undefined && <span className="rounded bg-[#1a1a1a] px-2 py-1 text-xs font-extrabold text-[#ececec]">{count}</span>}
    </button>
  );
}

function PageHeader({ action, subtitle, title }: { action?: React.ReactNode; subtitle: string; title: string }) {
  return (
    <div className="mb-5 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <h2 className="text-xl font-extrabold">{title}</h2>
        <p className="text-sm font-semibold text-[#808080]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nm-scrollbar max-h-[calc(100vh-10rem)] overflow-auto rounded-xl bg-[#ececec] shadow-nm-in">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="sticky top-0 z-10 whitespace-nowrap bg-[#ececec] px-3 py-3 text-xs font-extrabold uppercase tracking-[0.08em] text-[#808080]">{children}</th>;
}

function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`border-t border-[#d5d5d5] px-3 py-3 align-top ${mono ? "font-mono text-xs" : ""}`}>{children}</td>;
}

function UsersTable({ users }: { users: ApiUser[] }) {
  const queryClient = useQueryClient();
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});

  async function adjust(userId: string) {
    const amount = adjustments[userId] ?? 0;
    await api(`/api/admin/users/${userId}/balance-adjustments`, {
      method: "POST",
      body: JSON.stringify({ amount, note: "Manual admin adjustment" })
    });
    setAdjustments((current) => ({ ...current, [userId]: 0 }));
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <div>
      <PageHeader subtitle="Phone, balance, and balance adjustments stay visible. Extra account fields are collapsed." title="Users" />
      <div className="max-h-[calc(100vh-10rem)] space-y-3 overflow-auto pr-1">
        {users.map((user) => {
          const expanded = Boolean(expandedUsers[user.id]);
          return (
            <section key={user.id} className="rounded-xl bg-[#ececec] p-3 shadow-nm-in">
              <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.1fr)_minmax(120px,0.7fr)_minmax(260px,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#808080]">Phone number</div>
                  <div className="truncate text-base font-extrabold">{user.phoneNumber}</div>
                </div>
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#808080]">Balance</div>
                  <div className="text-base font-extrabold">{user.appTokenBalance.toLocaleString()}</div>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input
                    className="nm-field h-10 sm:w-32"
                    type="number"
                    value={adjustments[user.id] ?? 0}
                    onChange={(event) => setAdjustments((current) => ({ ...current, [user.id]: Number(event.target.value) }))}
                  />
                  <Button className="shrink-0" variant="secondary" onClick={() => void adjust(user.id)}>Adjust balance</Button>
                </div>
                <Button
                  className="shrink-0 justify-center"
                  variant="ghost"
                  onClick={() => setExpandedUsers((current) => ({ ...current, [user.id]: !expanded }))}
                >
                  <ChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} size={16} />
                  {expanded ? "Hide" : "Show more"}
                </Button>
              </div>
              {expanded && (
                <dl className="mt-4 grid gap-3 border-t border-[#d5d5d5] pt-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                  <UserDetail label="ID" mono value={user.id} />
                  <UserDetail label="External Auth User ID" mono value={user.externalAuthUserId ?? "-"} />
                  <UserDetail label="Status" value={user.status} />
                  <UserDetail label="Created At" value={formatDate(user.createdAt)} />
                  <UserDetail label="Updated At" value={formatDate(user.updatedAt)} />
                  <UserDetail label="Last Login At" value={formatDate(user.lastLoginAt)} />
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function UserDetail({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#808080]">{label}</dt>
      <dd className={`mt-1 break-words ${mono ? "font-mono text-xs" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

function RedeemCodesTable({ codes }: { codes: AdminRedeemCode[] }) {
  const [creating, setCreating] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState("");

  async function copyRedeemCode(codeId: string, code: string) {
    await window.navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopiedCodeId(codeId);
    window.setTimeout(() => setCopiedCodeId((current) => current === codeId ? "" : current), 1600);
  }

  return (
    <div>
      <PageHeader
        action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Create</Button>}
        subtitle="Generate codes, see usage limits, and audit who used each code."
        title="Redeem Codes"
      />
      {creating && <RedeemCodeModal onClose={() => setCreating(false)} />}
      <TableShell>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Code</Th>
            <Th>Amount</Th>
            <Th>Used</Th>
            <Th>Enabled</Th>
            <Th>Expires At</Th>
            <Th>Created At</Th>
            <Th>Redemption History</Th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id}>
              <Td mono>{code.id}</Td>
              <Td>
                {code.code ? (
                  <div className="flex min-w-52 items-center gap-2">
                    <span className="truncate font-mono text-xs font-extrabold">{code.code}</span>
                    <Button className="h-9 shrink-0 px-2" variant="secondary" onClick={() => void copyRedeemCode(code.id, code.code!)}>
                      {copiedCodeId === code.id ? <Check size={15} /> : <Copy size={15} />}
                      {copiedCodeId === code.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-[#808080]">Unavailable for old code</span>
                )}
              </Td>
              <Td>{code.appTokenAmount.toLocaleString()}</Td>
              <Td>{code.usedCount}/{code.usageLimit ?? "unlimited"}</Td>
              <Td>{code.enabled ? "Yes" : "No"}</Td>
              <Td>{formatDate(code.expiresAt)}</Td>
              <Td>{formatDate(code.createdAt)}</Td>
              <Td>
                {code.redemptions.length === 0 ? (
                  <span className="text-[#808080]">No redemptions</span>
                ) : (
                  <div className="min-w-72 space-y-2">
                    {code.redemptions.map((redemption) => (
                      <div key={redemption.id} className="rounded-lg bg-[#ececec] p-2 shadow-nm-in">
                        <div className="font-extrabold">{redemption.user.phoneNumber}</div>
                        <div className="text-xs text-[#808080]">{formatDate(redemption.createdAt)} · {redemption.appTokenAmount.toLocaleString()} tokens</div>
                      </div>
                    ))}
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function RedeemCodeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [appTokenAmount, setAppTokenAmount] = useState(10000);
  const [usageLimit, setUsageLimit] = useState(1);
  const [unlimited, setUnlimited] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);

  async function copyGeneratedCode() {
    if (!generatedCode) return;
    await window.navigator.clipboard?.writeText(generatedCode).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const createCode = useMutation({
    mutationFn: () =>
      api<{ code: string }>("/api/admin/redeem-codes", {
        method: "POST",
        body: JSON.stringify({ appTokenAmount, usageLimit: unlimited ? null : usageLimit })
      }),
    onSuccess: (data) => {
      setGeneratedCode(data.code);
      queryClient.invalidateQueries({ queryKey: ["admin-codes"] });
    }
  });

  return (
    <Modal title="Create Redeem Code" onClose={onClose}>
      <div className="space-y-4">
        <FormField help="How many app tokens the user receives each time this code is redeemed." label="App token amount">
          <input className="nm-field" min={1} type="number" value={appTokenAmount} onChange={(event) => setAppTokenAmount(Number(event.target.value))} />
        </FormField>
        <FormField help="How many total successful redemptions are allowed for this code." label="Usage limit">
          <input className="nm-field" disabled={unlimited} min={1} type="number" value={usageLimit} onChange={(event) => setUsageLimit(Number(event.target.value))} />
        </FormField>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} type="checkbox" />
          Allow unlimited redemptions
        </label>
        <Button className="w-full" disabled={createCode.isPending} onClick={() => createCode.mutate()}>
          <Ticket size={16} /> Generate
        </Button>
        {generatedCode && (
          <div className="rounded-xl bg-[#ececec] p-3 shadow-nm-in">
            <div className="mb-1 flex items-center gap-2 text-sm font-extrabold">
              <Check size={16} /> Generated code
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 break-all font-mono text-lg font-extrabold">{generatedCode}</div>
              <Button className="shrink-0" variant="secondary" onClick={() => void copyGeneratedCode()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SearchSettingsPanel({ settings }: { settings?: SearchSettings }) {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<SearchProvider>("tavily");
  const saveSettings = useMutation({
    mutationFn: (provider: SearchProvider) => api<SearchSettings>("/api/admin/settings/search", {
      method: "PATCH",
      body: JSON.stringify({ provider })
    }),
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(["admin-search-settings"], nextSettings);
    }
  });

  useEffect(() => {
    if (settings) setSelectedProvider(settings.provider);
  }, [settings]);

  const providers: Array<{ id: SearchProvider; name: string; description: string }> = [
    {
      id: "tavily",
      name: "Tavily",
      description: "General international web search with broad English-language coverage."
    },
    {
      id: "aliyun-iqs",
      name: "Alibaba Cloud IQS",
      description: "UnifiedSearch optimized for agent search, semantic retrieval, and multilingual results."
    }
  ];

  return (
    <div>
      <PageHeader
        subtitle="Choose the provider used by new web searches. Changes apply immediately without restarting the API."
        title="Search Settings"
      />
      {!settings ? (
        <section className="nm-card p-5 text-sm font-bold text-[#808080]">Loading search settings...</section>
      ) : (
        <div className="max-w-3xl space-y-4">
          <section className="nm-card space-y-3 p-4 sm:p-5">
            <div>
              <h3 className="text-base font-extrabold">Primary search engine</h3>
              <p className="text-sm font-semibold text-[#808080]">
                An in-progress search keeps its original provider. The next search uses the newly saved provider.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => {
                const configured = settings.configured[provider.id];
                const selected = selectedProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`focus-ring rounded-xl border-0 bg-[#ececec] p-4 text-left transition ${
                      selected ? "shadow-nm-in" : "shadow-nm-out hover:brightness-[1.02]"
                    } ${configured ? "" : "cursor-not-allowed opacity-55"}`}
                    disabled={!configured}
                    aria-pressed={selected}
                    onClick={() => setSelectedProvider(provider.id)}
                  >
                    <span className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-extrabold">{provider.name}</span>
                      <span className={`rounded px-2 py-1 text-[11px] font-extrabold ${
                        configured ? "bg-[#1a1a1a] text-[#ececec]" : "bg-[#d3d3d3] text-[#666]"
                      }`}>
                        {configured ? "Configured" : "API key missing"}
                      </span>
                    </span>
                    <span className="block text-sm font-semibold leading-relaxed text-[#808080]">{provider.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                disabled={selectedProvider === settings.provider || saveSettings.isPending || !settings.configured[selectedProvider]}
                onClick={() => saveSettings.mutate(selectedProvider)}
              >
                <Save size={16} />
                {saveSettings.isPending ? "Saving..." : "Save search engine"}
              </Button>
              <span className="text-sm font-semibold text-[#808080]">
                Active: {providers.find((provider) => provider.id === settings.provider)?.name}
              </span>
            </div>
            {saveSettings.isSuccess && selectedProvider === settings.provider && (
              <p className="flex items-center gap-2 text-sm font-bold">
                <Check size={16} /> Search engine updated.
              </p>
            )}
            {saveSettings.error && (
              <p className="text-sm font-bold text-red-700">{saveSettings.error.message}</p>
            )}
          </section>
          <section className="rounded-xl bg-[#ececec] p-4 text-sm font-semibold leading-relaxed text-[#808080] shadow-nm-in">
            Provider credentials remain in the server environment and are never returned to the browser. Configure both API keys to make both choices available.
          </section>
        </div>
      )}
    </div>
  );
}

function ModelsTable({ models }: { models: LlmModelDto[] }) {
  const [creating, setCreating] = useState(false);
  const [editingModel, setEditingModel] = useState<LlmModelDto | null>(null);

  return (
    <div>
      <PageHeader
        action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Create</Button>}
        subtitle="Model pricing, thresholds, provider IDs, and context settings."
        title="Models"
      />
      {creating && <ModelModalForm onClose={() => setCreating(false)} />}
      {editingModel && <ModelModalForm model={editingModel} onClose={() => setEditingModel(null)} />}
      <TableShell>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Display Name</Th>
            <Th>Chinese Name</Th>
            <Th>Series Name</Th>
            <Th>Chinese Series Name</Th>
            <Th>Provider</Th>
            <Th>Provider Model ID</Th>
            <Th>Logo</Th>
            <Th>Enabled</Th>
            <Th>Input / 1k</Th>
            <Th>Output / 1k</Th>
            <Th>Minimum Balance</Th>
            <Th>Max Output</Th>
            <Th>Context Window</Th>
            <Th>Sort Order</Th>
            <Th>Edit</Th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <Td mono>{model.id}</Td>
              <Td>{model.displayName}</Td>
              <Td>{model.displayNameZh || <span className="text-xs font-semibold text-[#808080]">Default</span>}</Td>
              <Td>{model.modelSeriesName || <span className="text-xs font-semibold text-[#808080]">Provider ID</span>}</Td>
              <Td>{model.modelSeriesNameZh || <span className="text-xs font-semibold text-[#808080]">Default</span>}</Td>
              <Td>{model.provider}</Td>
              <Td mono>{model.providerModelId}</Td>
              <Td>
                {model.logoUrl ? (
                  <img className="nm-admin-model-logo" src={model.logoUrl} alt="" />
                ) : (
                  <span className="text-xs font-semibold text-[#808080]">Auto</span>
                )}
              </Td>
              <Td>{model.enabled ? "Yes" : "No"}</Td>
              <Td>{model.inputAppTokensPer1k.toLocaleString()}</Td>
              <Td>{model.outputAppTokensPer1k.toLocaleString()}</Td>
              <Td>{model.minimumRequiredBalance.toLocaleString()}</Td>
              <Td>{model.maxOutputTokens.toLocaleString()}</Td>
              <Td>{model.contextWindowTokens.toLocaleString()}</Td>
              <Td>{model.sortOrder}</Td>
              <Td>
                <Button variant="secondary" onClick={() => setEditingModel(model)}>
                  <Pencil size={15} /> Edit
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function ModelModalForm({ model, onClose }: { model?: LlmModelDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ModelFormState>({
    displayName: model?.displayName ?? "",
    displayNameZh: model?.displayNameZh ?? "",
    modelSeriesName: model?.modelSeriesName ?? "",
    modelSeriesNameZh: model?.modelSeriesNameZh ?? "",
    provider: model?.provider ?? "openrouter",
    providerModelId: model?.providerModelId ?? "",
    logoUrl: model?.logoUrl ?? "",
    enabled: model?.enabled ?? true,
    inputAppTokensPer1k: model?.inputAppTokensPer1k ?? 1000,
    outputAppTokensPer1k: model?.outputAppTokensPer1k ?? 2000,
    minimumRequiredBalance: model?.minimumRequiredBalance ?? 1000,
    maxOutputTokens: model?.maxOutputTokens ?? 2000,
    contextWindowTokens: model?.contextWindowTokens ?? 64000,
    sortOrder: model?.sortOrder ?? 0
  });

  async function save() {
    const input = {
      ...form,
      displayNameZh: form.displayNameZh.trim() || null,
      modelSeriesName: form.modelSeriesName.trim() || null,
      modelSeriesNameZh: form.modelSeriesNameZh.trim() || null,
      logoUrl: form.logoUrl.trim() || null
    };
    await api(model ? `/api/admin/models/${model.id}` : "/api/admin/models", {
      method: model ? "PATCH" : "POST",
      body: JSON.stringify(input)
    });
    queryClient.invalidateQueries({ queryKey: ["admin-models"] });
    onClose();
  }

  return (
    <Modal title={model ? "Edit Model" : "Create Model"} onClose={onClose}>
      <div className="space-y-4">
      <ModelFields form={form} setForm={setForm} />
        <Button className="w-full" onClick={save}><Save size={16} /> Save</Button>
      </div>
    </Modal>
  );
}

function ModelFields({ form, setForm }: { form: ModelFormState; setForm: (form: ModelFormState) => void }) {
  return (
    <div className="space-y-3">
      <FormField help="Name shown to users in the model picker." label="Display name">
        <input className="nm-field" placeholder="DeepSeek Chat" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
      </FormField>
      <FormField help="Optional name shown when users select Simplified Chinese." label="Chinese display name">
        <input className="nm-field" placeholder="深度求索聊天" value={form.displayNameZh} onChange={(event) => setForm({ ...form, displayNameZh: event.target.value })} />
      </FormField>
      <FormField help="Optional subtitle shown in the model picker. Falls back to provider model ID when blank." label="Series name">
        <input className="nm-field" placeholder="DeepSeek V3" value={form.modelSeriesName} onChange={(event) => setForm({ ...form, modelSeriesName: event.target.value })} />
      </FormField>
      <FormField help="Optional series name shown when users select Simplified Chinese. Falls back to the default series name when blank." label="Chinese series name">
        <input className="nm-field" placeholder="深度求索 V3" value={form.modelSeriesNameZh} onChange={(event) => setForm({ ...form, modelSeriesNameZh: event.target.value })} />
      </FormField>
      <FormField help="The backend provider. Keep openrouter unless another provider is implemented." label="Provider">
        <input className="nm-field" placeholder="openrouter" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} />
      </FormField>
      <FormField help="The exact OpenRouter model slug, for example deepseek/deepseek-chat." label="Provider model ID">
        <input className="nm-field" placeholder="deepseek/deepseek-chat" value={form.providerModelId} onChange={(event) => setForm({ ...form, providerModelId: event.target.value })} />
      </FormField>
      <FormField help="Optional logo image shown in the model picker. Use /logos/name.svg, https://..., or a data:image URL." label="Logo URL">
        <div className="flex items-center gap-3">
          <input className="nm-field flex-1" placeholder="/logos/deepseek.svg" value={form.logoUrl} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} />
          {form.logoUrl.trim() && <img className="nm-admin-model-logo" src={form.logoUrl.trim()} alt="" />}
        </div>
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField help="App tokens charged for every 1,000 prompt/input tokens." label="Input app tokens per 1k">
          <input className="nm-field" min={0} type="number" value={form.inputAppTokensPer1k} onChange={(event) => setForm({ ...form, inputAppTokensPer1k: Number(event.target.value) })} />
        </FormField>
        <FormField help="App tokens charged for every 1,000 response/output tokens." label="Output app tokens per 1k">
          <input className="nm-field" min={0} type="number" value={form.outputAppTokensPer1k} onChange={(event) => setForm({ ...form, outputAppTokensPer1k: Number(event.target.value) })} />
        </FormField>
        <FormField help="User must have at least this balance before selecting the model." label="Minimum required balance">
          <input className="nm-field" min={0} type="number" value={form.minimumRequiredBalance} onChange={(event) => setForm({ ...form, minimumRequiredBalance: Number(event.target.value) })} />
        </FormField>
        <FormField help="Maximum number of tokens the model may generate in one response." label="Max output tokens">
          <input className="nm-field" min={1} type="number" value={form.maxOutputTokens} onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })} />
        </FormField>
        <FormField help="Total context size supported by this model." label="Context window tokens">
          <input className="nm-field" min={1000} type="number" value={form.contextWindowTokens} onChange={(event) => setForm({ ...form, contextWindowTokens: Number(event.target.value) })} />
        </FormField>
        <FormField help="Lower numbers appear earlier in model lists." label="Sort order">
          <input className="nm-field" type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" />
        Enabled
      </label>
    </div>
  );
}

function FormField({ children, help, label }: { children: React.ReactNode; help: string; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#808080]">{label}</span>
      {children}
      <span className="mt-1 block text-xs font-semibold leading-snug text-[#808080]">{help}</span>
    </label>
  );
}

type ModelFormState = {
  displayName: string;
  displayNameZh: string;
  modelSeriesName: string;
  modelSeriesNameZh: string;
  provider: string;
  providerModelId: string;
  logoUrl: string;
  enabled: boolean;
  inputAppTokensPer1k: number;
  outputAppTokensPer1k: number;
  minimumRequiredBalance: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  sortOrder: number;
};
