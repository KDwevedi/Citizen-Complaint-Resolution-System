import { useState, useEffect, useCallback } from 'react';

const AGENT_API = '/api/agent';

export default function VersionPanel() {
  const [versions, setVersions] = useState<Array<{ hash: string; fullHash: string; message: string; date: string; author: string; label: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveNotes, setSaveNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_API}/versions`);
      setVersions(await res.json());
    } catch (err) { console.error('Failed to fetch versions:', err); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  const handleSaveVersion = async () => {
    if (!saveLabel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${AGENT_API}/save-version`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: saveLabel.trim(), notes: saveNotes.trim() }) });
      const data = await res.json();
      if (data.success) { setShowSaveModal(false); setSaveLabel(''); setSaveNotes(''); fetchVersions(); }
      else alert('Failed: ' + data.error);
    } catch (err: any) { alert('Error: ' + err.message); }
    setSaving(false);
  };

  const handleRollback = async (commitHash: string) => {
    if (!window.confirm(`Rollback to ${commitHash}?`)) return;
    setRollingBack(commitHash);
    try {
      const res = await fetch(`${AGENT_API}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commitHash }) });
      const data = await res.json();
      if (data.success) setTimeout(() => window.location.reload(), 1500);
      else { alert('Failed: ' + data.error); setRollingBack(null); }
    } catch (err: any) { alert('Error: ' + err.message); setRollingBack(null); }
  };

  if (loading) return <div className="ccrs-versions-loading">Loading versions...</div>;

  return (
    <div className="ccrs-versions">
      <div className="ccrs-versions-header">
        <button className="ccrs-btn-save" onClick={() => setShowSaveModal(true)}>Save Current Version</button>
      </div>
      {showSaveModal && (
        <div className="ccrs-save-modal">
          <input className="ccrs-save-input" placeholder="Version label (e.g. v1-dashboard-redesign)" value={saveLabel} onChange={e => setSaveLabel(e.target.value)} autoFocus />
          <textarea className="ccrs-save-notes" placeholder="Notes (optional)" value={saveNotes} onChange={e => setSaveNotes(e.target.value)} rows={2} />
          <div className="ccrs-save-actions">
            <button className="ccrs-btn-confirm" onClick={handleSaveVersion} disabled={saving || !saveLabel.trim()}>{saving ? 'Saving...' : 'Save'}</button>
            <button className="ccrs-btn-cancel" onClick={() => setShowSaveModal(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="ccrs-versions-list">
        {versions.length === 0 && <div className="ccrs-versions-empty">No commits yet.</div>}
        {versions.map((v, i) => (
          <div key={v.hash} className="ccrs-version-item">
            <div className="ccrs-version-top">
              <code className="ccrs-version-hash">{v.hash}</code>
              {v.label && <span className="ccrs-version-label">{v.label}</span>}
              <span className="ccrs-version-date">{new Date(v.date).toLocaleString()}</span>
            </div>
            <div className="ccrs-version-msg">{v.message}</div>
            {i > 0 && <button className="ccrs-btn-rollback" onClick={() => handleRollback(v.hash)} disabled={rollingBack !== null}>{rollingBack === v.hash ? 'Rolling back...' : 'Rollback'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
