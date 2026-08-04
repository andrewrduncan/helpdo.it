import { useEffect, useState, type FormEvent } from 'react';
import './options.css';
import { getInstance, saveInstanceUrl, getDebug, setDebug } from '../../lib/settings';
import { clearConfigCache, fetchConfig } from '../../lib/config';

/**
 * Advanced settings (chrome://extensions → Details → Extension options).
 * The instance URL is "set and forget"; when pushed by enterprise managed
 * config it's read-only ("Managed by your organization").
 */
function App() {
  const [instanceUrl, setInstanceUrl] = useState('');
  const [managed, setManaged] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [debug, setDebugState] = useState(false);

  useEffect(() => {
    getInstance().then((inst) => {
      setInstanceUrl(inst.instanceUrl);
      setManaged(inst.managed);
    });
    getDebug().then(setDebugState);
  }, []);

  function onToggleDebug(on: boolean) {
    setDebugState(on);
    setDebug(on);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const url = instanceUrl.trim();
    const cfg = await fetchConfig(url);
    if (!cfg) {
      setStatus("Couldn't reach that instance — saved anyway, but check the URL.");
    } else {
      setStatus('Saved ✓');
    }
    await saveInstanceUrl(url);
    clearConfigCache();
    setBusy(false);
  }

  return (
    <main className="options">
      <h1>helpdo.it settings</h1>

      {managed ? (
        <div className="field">
          <label>Instance URL</label>
          <input type="text" value={instanceUrl} readOnly disabled />
          <p className="managed">🔒 Managed by your organization</p>
        </div>
      ) : (
        <form onSubmit={onSave}>
          <div className="field">
            <label htmlFor="instance">Instance URL</label>
            <input
              id="instance"
              type="url"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              placeholder="https://your-instance.helpdo.it"
            />
            <p className="hint">
              The helpdo.it instance this extension connects to. You rarely change this —
              set it once. Everything else (endpoint, providers, enabled sites) is read
              from the instance.
            </p>
          </div>
          <button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {status && <p className="status">{status}</p>}
        </form>
      )}

      <div className="field">
        <label className="toggle">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => onToggleDebug(e.target.checked)}
          />
          Debug logging
        </label>
        <p className="hint">
          Logs verbose <code>[helpdoit]</code> diagnostics to the browser console
          (e.g. guided-playback steps). Leave off for everyday use.
        </p>
      </div>
    </main>
  );
}

export default App;
