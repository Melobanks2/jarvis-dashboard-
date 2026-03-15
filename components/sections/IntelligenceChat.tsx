'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Copy, Zap, X, ChevronDown, Check, Brain } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { supabase } from '@/lib/supabase';

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  session_id?: string;
}

interface MemoryRow {
  id: string;
  category: string;
  key: string;
  value: string;
}

interface PushedPrompt {
  id: string;
  prompt_text: string;
  status: string;
  created_at: string;
}

// ── Strip MEMORY_UPDATE tags before rendering ─────────────────────────────────
function cleanContent(raw: string): string {
  return raw.replace(/\[MEMORY_UPDATE:[^\]]+\]/g, '').trim();
}

// ── Memory helpers ────────────────────────────────────────────────────────────

function buildMemoryContext(rows: MemoryRow[]): string {
  if (!rows?.length) return 'No memory yet — fresh start.';
  const grouped: Record<string, string[]> = {};
  rows.forEach(r => {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(`${r.key}: ${r.value}`);
  });
  return Object.entries(grouped)
    .map(([cat, items]) => `[${cat.toUpperCase()}]\n${items.join('\n')}`)
    .join('\n\n');
}

function buildSystemPrompt(memoryContext: string): string {
  return `You are Jarvis — the AI brain running this entire operation. You think like a senior engineer and a street-smart business operator at the same time. You have full memory of everything built.

MEMORY (loaded once — never ask to reload):
${memoryContext}

════════════════════════════════
HOW YOU COMMUNICATE
════════════════════════════════

You talk like a smart friend who knows the system cold — not like a report generator. Every response:

1. Opens with ONE punchy sentence — the core answer, no preamble
2. Shows a diagram if anything visual would help (systems, flows, comparisons, architecture)
3. Breaks it down in plain steps or bullets
4. Ends with the Claude Code prompt block if a build task is needed, then 2–3 next steps

No "Great question." No "Certainly!" No "I'd be happy to help." Just go.

════════════════════════════════
SVG DIAGRAMS — draw these, don't describe them
════════════════════════════════

Any time you explain a system, flow, or connection — draw it. Raw HTML SVG, output directly (not in a code block):

<div style="width:100%;overflow-x:auto;margin:12px 0;">
<svg width="100%" viewBox="0 0 680 [HEIGHT]" xmlns="http://www.w3.org/2000/svg">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>
[boxes, arrows, labels]
</svg>
</div>

Color system:
- Purple  #534AB7 — main concepts        fill="#534AB71A" stroke="#534AB7"
- Teal    #0F6E56 — active/running       fill="#0F6E561A" stroke="#0F6E56"
- Coral   #993C1D — disabled/broken      fill="#993C1D1A" stroke="#993C1D"
- Blue    #185FA5 — data / info flow     fill="#185FA51A" stroke="#185FA5"
- Amber   #BA7517 — warnings / manual    fill="#BA75171A" stroke="#BA7517"
- Gray    #5F5E5A — structural / neutral fill="#5F5E5A1A" stroke="#5F5E5A"

Box:   <rect x="X" y="Y" width="W" height="H" rx="8" fill="#COLOR1A" stroke="#COLOR" stroke-width="1.5"/>
Label: <text x="CX" y="CY" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#COLOR">text</text>
Arrow: <line x1="X1" y1="Y1" x2="X2" y2="Y2" stroke="#COLOR" stroke-width="1.5" marker-end="url(#arrow)"/>

════════════════════════════════
CLAUDE CODE PROMPT BLOCK
════════════════════════════════

When the answer involves building something, add this after your explanation — separated by a --- divider:

---

## 📋 Claude Code Prompt
> Ready to push — review before sending

**[TASK TITLE]**

Read these files first:
- [exact file paths]

[Full instructions. Self-contained. Claude Code has zero context — everything it needs is here.]

Success looks like:
- [specific done criteria]

---

════════════════════════════════
MEMORY UPDATES
════════════════════════════════

When you learn something worth keeping, append at the end of your message:
[MEMORY_UPDATE: category="x" key="y" value="z"]

One call = one API hit. Stay token-efficient. Memory loads once per session.`;
}

function getRelevantMemory(rows: MemoryRow[], messageText: string, n = 5): MemoryRow[] {
  const words = messageText.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  return rows
    .map(r => ({
      row: r,
      score: words.filter(w => `${r.category} ${r.key} ${r.value}`.toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.row);
}

function buildPushPrompt(msg: ChatMessage, memoryRows: MemoryRow[]): string {
  const relevant = getRelevantMemory(memoryRows, msg.content);
  const memCtx = relevant.length
    ? relevant.map(r => `${r.key}: ${r.value}`).join('\n')
    : 'No specific memory match — see full project context in Jarvis memory.';
  const ts = new Date().toLocaleString();
  return [
    `## Claude Code Task — pushed from Jarvis Intelligence Chat`,
    ts,
    ``,
    `### Context from Jarvis memory:`,
    memCtx,
    ``,
    `### Task:`,
    msg.content,
    ``,
    `### Notes:`,
    `- This was generated by Jarvis with full project context`,
    `- Supabase is already connected`,
    `- Do not change existing files unless specified`,
    `- Read the codebase before writing any code`,
  ].join('\n');
}

// ── Background DB helpers ─────────────────────────────────────────────────────

async function parseMemoryUpdates(
  text: string,
  setMemoryRows: React.Dispatch<React.SetStateAction<MemoryRow[]>>
) {
  const regex = /\[MEMORY_UPDATE:\s*category="([^"]+)"\s+key="([^"]+)"\s+value="([^"]+)"\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, category, key, value] = match;
    const { data } = await supabase
      .from('jarvis_memory')
      .upsert({ category, key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
      .single();
    if (data) {
      setMemoryRows(prev => {
        const idx = prev.findIndex(r => r.key === key);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = data as MemoryRow;
          return updated;
        }
        return [...prev, data as MemoryRow];
      });
    }
  }
}

async function cacheVisual(text: string) {
  const svgMatch = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!svgMatch) return;
  const topicMatch = text.match(/#{1,3}\s+(.+)/);
  const topic = topicMatch
    ? topicMatch[1].toLowerCase().replace(/\s+/g, '_').slice(0, 80)
    : `diagram_${Date.now()}`;
  await supabase
    .from('jarvis_visual_cache')
    .upsert(
      { topic, svg_content: svgMatch[0], last_used: new Date().toISOString() },
      { onConflict: 'topic' }
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IntelligenceChat() {
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [memoryRows, setMemoryRows]       = useState<MemoryRow[]>([]);
  const [input, setInput]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [tablesError, setTablesError]     = useState<string | null>(null);
  const [pushModal, setPushModal]         = useState<{ open: boolean; message: ChatMessage | null }>({ open: false, message: null });
  const [pushQueue, setPushQueue]         = useState<PushedPrompt[]>([]);
  const [queueOpen, setQueueOpen]         = useState(false);
  const [copiedId, setCopiedId]           = useState<string | null>(null);
  const [modalCopied, setModalCopied]     = useState(false);

  const sessionId      = useRef(Math.random().toString(36).slice(2));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load history + memory once on mount
  useEffect(() => {
    async function init() {
      try {
        const [msgRes, memRes, queueRes] = await Promise.all([
          supabase
            .from('jarvis_chat_messages')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50),
          supabase.from('jarvis_memory').select('*'),
          supabase
            .from('jarvis_pushed_prompts')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

        if (msgRes.error) {
          if (msgRes.error.code === '42P01') {
            setTablesError('Supabase tables not created yet. Run the SQL from the setup instructions in your Supabase dashboard.');
          } else {
            console.error('jarvis_chat_messages load error:', msgRes.error);
          }
        } else {
          setMessages((msgRes.data ?? []) as ChatMessage[]);
        }

        if (!memRes.error)   setMemoryRows((memRes.data ?? []) as MemoryRow[]);
        if (!queueRes.error) setPushQueue((queueRes.data ?? []) as PushedPrompt[]);
      } catch (e) {
        console.error('IntelligenceChat init error:', e);
      } finally {
        setLoadingHistory(false);
      }
    }
    init();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    // Capture messages for API call BEFORE state update
    const apiMessages = [...messages, userMsg]
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Save user message (fire and forget)
    supabase
      .from('jarvis_chat_messages')
      .insert({ role: 'user', content: text, session_id: sessionId.current })
      .select()
      .single()
      .then(({ data }) => {
        if (data) {
          setMessages(prev =>
            prev.map(m => (m.id === userMsg.id ? (data as ChatMessage) : m))
          );
        }
      });

    try {
      const res = await fetch('/api/jarvis-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt: buildSystemPrompt(buildMemoryContext(memoryRows)),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');

      const content: string = data.content ?? '';

      // Save assistant message
      const { data: savedAssistant } = await supabase
        .from('jarvis_chat_messages')
        .insert({
          role: 'assistant',
          content,
          session_id: sessionId.current,
          has_visual: /<svg/i.test(content),
        })
        .select()
        .single();

      const assistantMsg = (savedAssistant ?? {
        id: `tmp-a-${Date.now()}`,
        role: 'assistant' as const,
        content,
        created_at: new Date().toISOString(),
      }) as ChatMessage;

      setMessages(prev => [...prev, assistantMsg]);

      // Background: parse memory + cache visuals
      parseMemoryUpdates(content, setMemoryRows);
      if (/<svg/i.test(content)) cacheVisual(content);
    } catch (err: unknown) {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant' as const,
          content: `**Error:** ${err instanceof Error ? err.message : 'Something went wrong. Check ANTHROPIC_API_KEY in Vercel env vars.'}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, memoryRows]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id ?? null);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openPushModal = (msg: ChatMessage) => {
    setPushModal({ open: true, message: msg });
    setModalCopied(false);
  };

  const copyModalPrompt = async () => {
    if (!pushModal.message) return;
    await navigator.clipboard.writeText(buildPushPrompt(pushModal.message, memoryRows));
    setModalCopied(true);
    setTimeout(() => setModalCopied(false), 2000);
  };

  const saveToQueue = async () => {
    if (!pushModal.message) return;
    const promptText = buildPushPrompt(pushModal.message, memoryRows);
    const msgId = pushModal.message.id;
    const sourceId = msgId && !msgId.startsWith('tmp') ? msgId : null;
    const { data } = await supabase
      .from('jarvis_pushed_prompts')
      .insert({ prompt_text: promptText, source_message_id: sourceId, status: 'pending' })
      .select()
      .single();
    if (data) setPushQueue(prev => [data as PushedPrompt, ...prev]);
    setPushModal({ open: false, message: null });
  };

  const copyQueueItem = async (item: PushedPrompt) => {
    await navigator.clipboard.writeText(item.prompt_text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const markQueueDone = async (id: string) => {
    await supabase.from('jarvis_pushed_prompts').update({ status: 'copied' }).eq('id', id);
    setPushQueue(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tables error banner */}
      {tablesError && (
        <div
          className="px-4 py-2 text-[11px] flex-shrink-0"
          style={{ background: 'rgba(153,60,29,0.2)', borderBottom: '1px solid rgba(153,60,29,0.3)', color: '#f87171' }}
        >
          ⚠️ {tablesError}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-32 text-[11px]" style={{ color: '#52526e' }}>
            Loading conversation history...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(83,74,183,0.15)', border: '1px solid rgba(83,74,183,0.25)' }}
            >
              <Brain size={22} style={{ color: '#a78bfa' }} />
            </div>
            <div className="text-[13px] font-semibold" style={{ color: '#c4c4d6' }}>Jarvis Intelligence Chat</div>
            <div className="text-[11px] text-center max-w-xs leading-relaxed" style={{ color: '#52526e' }}>
              Ask Jarvis anything about the project. Get visual explanations, architecture diagrams, and push tasks directly to Claude Code.
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onCopy={copyMessage}
              onPush={openPushModal}
              copiedId={copiedId}
            />
          ))
        )}

        {/* Loading dots */}
        {loading && (
          <div className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1"
              style={{ background: 'rgba(83,74,183,0.2)', border: '1px solid rgba(83,74,183,0.3)' }}
            >
              <Brain size={13} style={{ color: '#a78bfa' }} />
            </div>
            <div
              className="px-4 py-3 rounded-2xl rounded-tl-sm"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex gap-1.5 items-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: '#a78bfa' }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Prompt Queue */}
      {pushQueue.length > 0 && (
        <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setQueueOpen(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-[10px] font-medium"
            style={{ color: '#a78bfa', background: 'rgba(83,74,183,0.05)' }}
          >
            <Zap size={11} />
            Prompt Queue ({pushQueue.length})
            <ChevronDown
              size={11}
              className="ml-auto transition-transform duration-200"
              style={{ transform: queueOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>

          <AnimatePresence>
            {queueOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="px-3 pb-2 pt-1.5 flex flex-wrap gap-1.5"
                  style={{ background: 'rgba(83,74,183,0.04)' }}
                >
                  {pushQueue.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[9px]"
                      style={{ background: 'rgba(83,74,183,0.12)', border: '1px solid rgba(83,74,183,0.2)', color: '#c4c4d6' }}
                    >
                      <span className="max-w-[160px] truncate">{item.prompt_text.slice(0, 60)}</span>
                      <button
                        onClick={() => copyQueueItem(item)}
                        className="ml-1 hover:text-white transition-colors"
                        title="Copy prompt"
                      >
                        {copiedId === item.id
                          ? <Check size={9} style={{ color: '#4ade80' }} />
                          : <Copy size={9} />}
                      </button>
                      <button
                        onClick={() => markQueueDone(item.id)}
                        className="hover:text-red-400 transition-colors"
                        title="Mark done"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Input bar */}
      <div
        className="flex-shrink-0 flex items-end gap-3 px-4 py-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(11,12,19,0.6)' }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask Jarvis anything... (Enter to send, Shift+Enter for newline)"
          rows={1}
          className="flex-1 resize-none rounded-xl px-4 py-3 text-[13px] outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#c4c4d6',
            minHeight: 44,
            maxHeight: 96,
            lineHeight: '1.5',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = 'rgba(83,74,183,0.45)'; }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        />
        <motion.button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: loading || !input.trim() ? 'rgba(83,74,183,0.15)' : 'rgba(83,74,183,0.85)',
            color: loading || !input.trim() ? '#52526e' : '#fff',
            transition: 'background 0.15s, color 0.15s',
          }}
          whileHover={!loading && !!input.trim() ? { scale: 1.06 } : {}}
          whileTap={!loading && !!input.trim() ? { scale: 0.94 } : {}}
        >
          <Send size={15} />
        </motion.button>
      </div>

      {/* Push Modal */}
      <AnimatePresence>
        {pushModal.open && pushModal.message && (
          <PushModal
            prompt={buildPushPrompt(pushModal.message, memoryRows)}
            copied={modalCopied}
            onCopy={copyModalPrompt}
            onSave={saveToQueue}
            onClose={() => setPushModal({ open: false, message: null })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onCopy,
  onPush,
  copiedId,
}: {
  msg: ChatMessage;
  onCopy: (m: ChatMessage) => void;
  onPush: (m: ChatMessage) => void;
  copiedId: string | null;
}) {
  const isAssistant = msg.role === 'assistant';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex items-start gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}
    >
      {/* Avatar */}
      {isAssistant ? (
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1"
          style={{ background: 'rgba(83,74,183,0.2)', border: '1px solid rgba(83,74,183,0.3)' }}
        >
          <Brain size={13} style={{ color: '#a78bfa' }} />
        </div>
      ) : (
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1 text-[10px] font-bold"
          style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}
        >
          C
        </div>
      )}

      {/* Bubble + actions */}
      <div className={`flex flex-col gap-1.5 ${isAssistant ? 'max-w-[88%]' : 'max-w-[75%] items-end'}`}>
        <div
          className="px-4 py-3 rounded-2xl"
          style={{
            background: isAssistant ? 'rgba(255,255,255,0.04)' : 'rgba(83,74,183,0.15)',
            border: `1px solid ${isAssistant ? 'rgba(255,255,255,0.07)' : 'rgba(83,74,183,0.25)'}`,
            borderTopLeftRadius: isAssistant ? 4 : undefined,
            borderTopRightRadius: isAssistant ? undefined : 4,
          }}
        >
          {isAssistant ? (
            <div className="jarvis-content text-[13px]" style={{ color: '#c4c4d6', lineHeight: '1.65' }}>
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                {cleanContent(msg.content)}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-[13px] whitespace-pre-wrap" style={{ color: '#c4c4d6', lineHeight: '1.65' }}>
              {msg.content}
            </div>
          )}
        </div>

        {/* Action buttons — assistant only */}
        {isAssistant && (
          <div className="flex items-center gap-1 px-1">
            <button
              onClick={() => onCopy(msg)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors"
              style={{ color: copiedId === msg.id ? '#4ade80' : '#52526e' }}
              onMouseEnter={e => { if (copiedId !== msg.id) (e.currentTarget as HTMLElement).style.color = '#c4c4d6'; }}
              onMouseLeave={e => { if (copiedId !== msg.id) (e.currentTarget as HTMLElement).style.color = '#52526e'; }}
            >
              {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
              {copiedId === msg.id ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => onPush(msg)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
              style={{
                color: '#a78bfa',
                background: 'rgba(83,74,183,0.1)',
                border: '1px solid rgba(83,74,183,0.2)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(83,74,183,0.2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(83,74,183,0.1)'; }}
            >
              <Zap size={10} />
              Push to Claude Code
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── PushModal ─────────────────────────────────────────────────────────────────

function PushModal({
  prompt,
  copied,
  onCopy,
  onSave,
  onClose,
}: {
  prompt: string;
  copied: boolean;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-[80]"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed z-[90] flex flex-col"
        style={{
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(680px, calc(100vw - 32px))',
          maxHeight: '70vh',
          background: 'rgba(14,15,24,0.98)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(83,74,183,0.3)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(83,74,183,0.1)',
        }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: '#a78bfa' }} />
            <span className="text-[13px] font-semibold" style={{ color: '#c4c4d6' }}>Push to Claude Code</span>
          </div>
          <button onClick={onClose} className="p-1 transition-colors" style={{ color: '#52526e' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c4c4d6'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#52526e'; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Prompt text */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          <textarea
            readOnly
            value={prompt}
            className="w-full resize-none text-[11px] font-mono rounded-lg p-4 outline-none"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              color: '#8e8ea0',
              minHeight: 200,
              lineHeight: '1.7',
            }}
            rows={12}
          />
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <motion.button
            onClick={onCopy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold"
            style={{
              background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(83,74,183,0.85)',
              color: copied ? '#4ade80' : '#fff',
              border: copied ? '1px solid rgba(74,222,128,0.3)' : 'none',
            }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy Prompt'}
          </motion.button>
          <motion.button
            onClick={onSave}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium"
            style={{
              background: 'rgba(255,255,255,0.05)',
              color: '#8e8ea0',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            whileHover={{ background: 'rgba(255,255,255,0.09)' }}
            whileTap={{ scale: 0.97 }}
          >
            Save to Queue
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
