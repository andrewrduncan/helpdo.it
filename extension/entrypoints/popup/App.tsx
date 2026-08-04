import { useEffect, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import './App.css';
import { getInstance, saveInstanceUrl } from '../../lib/settings';
import { clearConfigCache, fetchConfig, getConfig, type AppConfig } from '../../lib/config';
import { getAuth, isTrainer, signIn, signOut, type AuthInfo } from '../../lib/auth';
import {
  listDomains,
  enabledDomainIds,
  enableDomain,
  disableDomain,
  hostOf,
  type DomainInfo,
} from '../../lib/domains';

// Background message types (string literals to avoid importing the worker module).
const DOMAINS_REFRESH_MESSAGE = 'helpdoit:domains-refresh';
const DOMAIN_TRAIN_HERE_MESSAGE = 'helpdoit:domain-train-here';

type Phase = 'loading' | 'connect' | 'signin' | 'profile';

const DEFAULT_PROVIDERS = [{ id: 'google', label: 'Google' }];

function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tabHost, setTabHost] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [domainsBusy, setDomainsBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  // Load the domain registry, the user's enablements, and the current tab's host
  // once we're signed in (the Domains section lives in the profile view).
  useEffect(() => {
    if (phase !== 'profile') return;
    void (async () => {
      const [tabs, list, on] = await Promise.all([
        browser.tabs.query({ active: true, currentWindow: true }),
        listDomains(true),
        enabledDomainIds(true),
      ]);
      setTabHost(hostOf(tabs[0]?.url ?? ''));
      setDomains(list);
      setEnabled(on);
    })();
  }, [phase]);

  async function toggleDomain(id: string, on: boolean) {
    setDomainsBusy(true);
    setError(null);
    try {
      if (on) await enableDomain(id);
      else await disableDomain(id);
      setEnabled((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
      // Tell the background to drop its gating cache so the next page load reflects this.
      browser.runtime.sendMessage({ type: DOMAINS_REFRESH_MESSAGE }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDomainsBusy(false);
    }
  }

  async function trainNewDomain() {
    await browser.runtime.sendMessage({ type: DOMAIN_TRAIN_HERE_MESSAGE }).catch(() => {});
    window.close(); // the active tab reloads into Train mode
  }

  async function load() {
    const inst = await getInstance();
    if (!inst.instanceUrl) {
      setPhase('connect');
      return;
    }
    const [cfg, a] = await Promise.all([getConfig(), getAuth()]);
    setConfig(cfg);
    setAuth(a);
    setPhase(a ? 'profile' : 'signin');
  }

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = draft.trim();
    const cfg = await fetchConfig(url);
    if (!cfg) {
      setError("Couldn't reach that instance — check the URL.");
      setBusy(false);
      return;
    }
    await saveInstanceUrl(url);
    clearConfigCache();
    setBusy(false);
    await load();
  }

  async function onSignIn(providerId: string) {
    setBusy(true);
    setError(null);
    try {
      setAuth(await signIn(providerId));
      setPhase('profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await signOut();
    setAuth(null);
    setPhase('signin');
  }

  const providers = config?.providers?.length ? config.providers : DEFAULT_PROVIDERS;
  const currentDomain = tabHost ? domains.find((d) => d.host.toLowerCase() === tabHost) : undefined;

  return (
    <div className="popup">
      <h1>helpdo.it</h1>

      {phase === 'loading' && <p className="hint">Loading…</p>}

      {phase === 'connect' && (
        <form onSubmit={onConnect}>
          <p className="hint">Connect to your helpdo.it instance to get started.</p>
          <label>
            Instance URL
            <input
              type="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://your-instance.helpdo.it"
              required
            />
          </label>
          <button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          {error && <small className="error">{error}</small>}
        </form>
      )}

      {phase === 'signin' && (
        <div className="stack">
          <p className="hint">Sign in to use helpdo.it on this instance.</p>
          {providers.map((p) => (
            <button key={p.id} onClick={() => onSignIn(p.id)} disabled={busy} aria-busy={busy}>
              {busy ? 'Signing in…' : `Sign in with ${p.label}`}
            </button>
          ))}
          {error && <small className="error">{error}</small>}
        </div>
      )}

      {phase === 'profile' && auth && (
        <div className="stack">
          <div className="profile">
            {auth.picture ? (
              <img className="avatar" src={auth.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="avatar avatar-fallback">{(auth.name || auth.email || '?').charAt(0)}</div>
            )}
            <div>
              <div className="identity">{auth.name || auth.email || 'Signed in'}</div>
              {auth.name && auth.email && <small className="hint">{auth.email}</small>}
            </div>
          </div>
          <button className="ghost" onClick={onSignOut}>
            Sign out
          </button>

          <div className="domains">
            <h2>Domains</h2>
            {error && <small className="error">{error}</small>}
            {tabHost ? (
              <p className="hint">
                This page: <strong>{tabHost}</strong>
              </p>
            ) : (
              <p className="hint">No site detected for the current tab.</p>
            )}

            {tabHost && currentDomain && (
              <label className="domain-row">
                <input
                  type="checkbox"
                  checked={enabled.includes(currentDomain.id)}
                  disabled={domainsBusy}
                  onChange={(e) => toggleDomain(currentDomain.id, e.target.checked)}
                />
                Show helpdo.it here
              </label>
            )}

            {tabHost &&
              !currentDomain &&
              (isTrainer(auth) ? (
                <button onClick={trainNewDomain} disabled={domainsBusy}>
                  Train new domain
                </button>
              ) : (
                <p className="hint">No help is set up for this site yet.</p>
              ))}

            {domains.length > 0 && (
              <details>
                <summary>All domains ({domains.length})</summary>
                <div className="domain-list">
                  {domains.map((d) => (
                    <label key={d.id} className="domain-row">
                      <input
                        type="checkbox"
                        checked={enabled.includes(d.id)}
                        disabled={domainsBusy}
                        onChange={(e) => toggleDomain(d.id, e.target.checked)}
                      />
                      {d.name && d.name !== d.host ? `${d.name} (${d.host})` : d.host}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {phase !== 'connect' && phase !== 'loading' && (
        <button
          type="button"
          className="link"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Manage instance
        </button>
      )}
    </div>
  );
}

export default App;
