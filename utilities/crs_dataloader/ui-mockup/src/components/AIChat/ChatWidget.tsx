import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './chatWidget.css';
import VersionPanel from './VersionPanel';

const AGENT_API = '/api/agent';

/** Lightweight markdown-ish renderer — handles **bold**, `code`, ```blocks```, headers, lists, newlines */
function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="ccrs-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Header
    if (line.startsWith('### ')) {
      elements.push(<div key={elements.length} className="ccrs-md-h3">{inlineFormat(line.slice(4))}</div>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<div key={elements.length} className="ccrs-md-h2">{inlineFormat(line.slice(3))}</div>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<div key={elements.length} className="ccrs-md-h1">{inlineFormat(line.slice(2))}</div>);
      i++; continue;
    }

    // List item
    if (line.match(/^[-*] /)) {
      elements.push(<div key={elements.length} className="ccrs-md-li">{inlineFormat(line.slice(2))}</div>);
      i++; continue;
    }

    // Numbered list
    if (line.match(/^\d+\. /)) {
      const content = line.replace(/^\d+\.\s*/, '');
      elements.push(<div key={elements.length} className="ccrs-md-li">{inlineFormat(content)}</div>);
      i++; continue;
    }

    // Empty line = paragraph break
    if (!line.trim()) {
      elements.push(<div key={elements.length} className="ccrs-md-br" />);
      i++; continue;
    }

    // Regular paragraph
    elements.push(<div key={elements.length} className="ccrs-md-p">{inlineFormat(line)}</div>);
    i++;
  }

  return <>{elements}</>;
}

/** Inline formatting: **bold**, `code`, *italic* */
function inlineFormat(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Split by inline code first, then bold, then italic
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const m = match[0];
    if (m.startsWith('`')) {
      parts.push(<code key={match.index} className="ccrs-inline-code">{m.slice(1, -1)}</code>);
    } else if (m.startsWith('**')) {
      parts.push(<strong key={match.index}>{m.slice(2, -2)}</strong>);
    } else if (m.startsWith('*')) {
      parts.push(<em key={match.index}>{m.slice(1, -1)}</em>);
    }
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

interface Message {
  role: string;
  content: string;
  status?: string;
  commitHash?: string | null;
  summary?: string;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'versions' | 'staged'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [stagedChanges, setStagedChanges] = useState<Array<{ hash: string; message: string; date: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (isOpen && inputRef.current) inputRef.current.focus(); }, [isOpen]);

  // Fetch staged (unsaved) changes
  const fetchStaged = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_API}/staged`);
      const data = await res.json();
      setStagedChanges(data);
    } catch {}
  }, []);

  useEffect(() => { if (isOpen) fetchStaged(); }, [isOpen, fetchStaged]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage = input.trim();
    setInput('');
    setIsStreaming(true);
    setCurrentTool(null);

    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    // Track current block index — new_block events push new bubbles
    let currentIdx = newMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '', status: 'streaming' }]);

    try {
      const response = await fetch(`${AGENT_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          context: {
            currentRoute: window.location.pathname,
            conversationHistory: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          },
        }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'new_block') {
              // Start a new message bubble for each thinking→text→tool cycle
              const role = event.blockType === 'tool' ? 'tool' : 'assistant';
              const content = event.blockType === 'tool' ? (event.label || '') : '';
              setMessages(prev => {
                // Remove empty trailing bubble if any
                const cleaned = prev.filter((m, i) => i < currentIdx || m.content.trim());
                currentIdx = cleaned.length;
                return [...cleaned, { role, content, status: 'streaming' }];
              });
            } else if (event.type === 'text') {
              setMessages(prev => {
                const updated = [...prev];
                if (updated[currentIdx]) {
                  updated[currentIdx] = { ...updated[currentIdx], content: updated[currentIdx].content + event.content };
                }
                return updated;
              });
            } else if (event.type === 'tool_use') {
              setCurrentTool(event.label || event.tool);
            } else if (event.type === 'status') {
              setCurrentTool(event.detail ? `${event.content} ${event.detail}` : event.content);
            } else if (event.type === 'done') {
              setMessages(prev => {
                const updated = [...prev];
                if (updated[currentIdx]) {
                  updated[currentIdx] = { ...updated[currentIdx], status: 'done', commitHash: event.commitHash };
                }
                return updated;
              });
              setCurrentTool(null);
              fetchStaged();
            } else if (event.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                if (updated[currentIdx]) {
                  updated[currentIdx] = { ...updated[currentIdx], content: updated[currentIdx].content + '\n\nError: ' + event.content, status: 'error' };
                }
                return updated;
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', content: 'Connection error: ' + err.message, status: 'error' };
        return updated;
      });
    }
    setIsStreaming(false);
    setCurrentTool(null);
  }, [input, isStreaming, messages, fetchStaged]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleSaveVersion = async () => {
    const label = prompt('Version label (e.g. v1-dashboard-redesign):');
    if (!label) return;
    const notes = prompt('Notes (optional):') || '';
    await fetch(`${AGENT_API}/save-version`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, notes }) });
    fetchStaged();
  };

  const handleDiscard = async () => {
    if (!confirm('Discard all unsaved changes? This will revert to the last saved version.')) return;
    await fetch(`${AGENT_API}/discard`, { method: 'POST' });
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleRollback = async (hash: string) => {
    if (!confirm(`Rollback to ${hash}?`)) return;
    await fetch(`${AGENT_API}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commitHash: hash }) });
    setTimeout(() => window.location.reload(), 1500);
  };

  const stagedCount = stagedChanges.length;

  if (!isOpen) {
    return (
      <button className="ccrs-chat-fab" onClick={() => setIsOpen(true)} title="AI Editor">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {stagedCount > 0 && <span className="ccrs-badge">{stagedCount}</span>}
      </button>
    );
  }

  return (
    <div className="ccrs-chat-panel">
      <div className="ccrs-chat-header">
        <div className="ccrs-chat-tabs">
          <button className={`ccrs-tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Chat</button>
          <button className={`ccrs-tab ${activeTab === 'staged' ? 'active' : ''}`} onClick={() => setActiveTab('staged')}>
            Changes{stagedCount > 0 && <span className="ccrs-tab-count">{stagedCount}</span>}
          </button>
          <button className={`ccrs-tab ${activeTab === 'versions' ? 'active' : ''}`} onClick={() => setActiveTab('versions')}>Versions</button>
        </div>
        <button className="ccrs-chat-close" onClick={() => setIsOpen(false)}>&times;</button>
      </div>

      {activeTab === 'versions' ? <VersionPanel /> : activeTab === 'staged' ? (
        <div className="ccrs-staged">
          <div className="ccrs-staged-actions">
            <button className="ccrs-btn-save-staged" onClick={handleSaveVersion} disabled={stagedCount === 0}>Save Version</button>
            <button className="ccrs-btn-discard" onClick={handleDiscard} disabled={stagedCount === 0}>Discard All</button>
          </div>
          {stagedCount === 0 ? (
            <div className="ccrs-staged-empty">No unsaved changes. All changes are saved.</div>
          ) : (
            <div className="ccrs-staged-list">
              {stagedChanges.map((c, i) => (
                <div key={c.hash} className="ccrs-staged-item">
                  <div className="ccrs-staged-desc">{c.message.replace(/^AI:\s*/, '')}</div>
                  <div className="ccrs-staged-meta">
                    <code>{c.hash}</code>
                    <span>{new Date(c.date).toLocaleTimeString()}</span>
                    <button className="ccrs-btn-rollback-sm" onClick={() => handleRollback(c.hash)}>rollback here</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="ccrs-chat-messages">
            {messages.length === 0 && (
              <div className="ccrs-chat-empty">
                Describe a UI change and I'll edit the code live.<br />
                <span className="ccrs-chat-hint">e.g. "add a status badge to the department list"</span>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`ccrs-msg ccrs-msg-${msg.role}`}>
                <div className="ccrs-msg-content">
                  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                  {!msg.content && msg.status === 'streaming' && <span className="ccrs-typing">...</span>}
                </div>
                {msg.commitHash && <div className="ccrs-msg-commit">Changes applied [{msg.commitHash}]</div>}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {(isStreaming || currentTool) && (
            <div className="ccrs-chat-status">
              <span className="ccrs-spinner" />
              <span className="ccrs-status-text">{currentTool || 'Thinking...'}</span>
            </div>
          )}

          <div className="ccrs-chat-input-area">
            <textarea ref={inputRef} className="ccrs-chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Describe a UI change..." rows={2} disabled={isStreaming} />
            <button className="ccrs-chat-send" onClick={sendMessage} disabled={isStreaming || !input.trim()}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
