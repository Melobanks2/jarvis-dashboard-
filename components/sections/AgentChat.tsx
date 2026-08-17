'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp, Brain, ChevronDown, Cpu, Square, Trash2, AlertTriangle, Sparkles,
} from 'lucide-react';
import { GlassCard, GlassPill } from '@/components/ui/GlassCard';

// Runs against the Ollama instance on this MacBook via /api/agent-chat.
// Nothing in this conversation leaves the machine.

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2' };
const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;
const TAP = { scale: 0.97 };

const STORE_KEY = 'jarvis_agentchat_v1';

interface Msg { role: 'user' | 'assistant'; content: string; thinking?: string; }

const SUGGESTIONS = [
  'What should I do first today?',
  'Which refunds are about to expire?',
  'Summarize my hot leads and what is stalling them',
  'Where is my money actually sitting right now?',
];

export function AgentChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [think, setThink] = useState(false);
  const [models, setModels] = useState<{ name: string; size: string }[]>([]);
  const [model, setModel] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [host, setHost] = useState('');
  const [openThink, setOpenThink] = useState<Record<number, boolean>>({});

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Probe the local model + load its catalogue.
  useEffect(() => {
    let live = true;
    fetch('/api/agent-chat')
      .then(r => r.json())
      .then(d => {
        if (!live) return;
        setOnline(!!d.online);
        setModels(d.models ?? []);
        setHost(d.host ?? '');
        setModel(prev => prev || d.defaultModel || d.models?.[0]?.name || '');
      })
      .catch(() => live && setOnline(false));
    return () => { live = false; };
  }, []);

  // Restore / persist transcript locally.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const stop = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setErr('');
    setInput('');

    const outgoing: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...outgoing, { role: 'assistant', content: '' }]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: outgoing.map(m => ({ role: m.role, content: m.content })),
          model, think,
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', content = '', thinking = '';

      // Ollama streams NDJSON — one JSON object per line, split arbitrarily
      // across chunks, so hold the trailing partial line in the buffer.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const s = line.trim();
          if (!s) continue;
          let j: { message?: { content?: string; thinking?: string }; error?: string };
          try { j = JSON.parse(s); } catch { continue; }
          if (j.error) throw new Error(j.error);
          content  += j.message?.content  ?? '';
          thinking += j.message?.thinking ?? '';
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content, thinking: thinking || undefined };
            return next;
          });
        }
      }

      if (!content.trim() && !thinking.trim()) {
        throw new Error('The model returned nothing. Try a larger reply budget or a different model.');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if ((e as Error).name === 'AbortError') {
        // Keep whatever streamed before the stop.
        setMessages(prev => prev.filter(m => m.content.trim() || m.thinking?.trim()));
      } else {
        setErr(msg);
        setMessages(prev => prev.slice(0, -1)); // drop the empty assistant bubble
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, messages, model, think]);

  const clear = () => { setMessages([]); setErr(''); try { localStorage.removeItem(STORE_KEY); } catch {} };

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  };

  const statusPill = useMemo(() => {
    if (online === null) return { text: 'checking local model…', color: C.warn };
    if (!online) return { text: 'local model offline', color: C.urg };
    return { text: `${model || 'local'} · on this Mac`, color: C.pos };
  }, [online, model]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-textb">Agent chat</h1>
        <GlassPill color={statusPill.color}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusPill.color }} />
          {statusPill.text}
        </GlassPill>

        <div className="ml-auto flex items-center gap-2">
          {models.length > 1 && (
            <div className="relative">
              <select value={model} onChange={e => setModel(e.target.value)} disabled={busy}
                className="appearance-none rounded-full border border-border bg-white/[0.06] pl-3 pr-8 py-1.5 text-[12px] text-jtext hover:text-textb outline-none cursor-pointer disabled:opacity-50"
                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)' }}>
                {models.map(m => <option key={m.name} value={m.name}>{m.name}{m.size ? ` · ${m.size}` : ''}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-dimtext" />
            </div>
          )}
          <motion.button whileTap={TAP} transition={SPRING} onClick={() => setThink(t => !t)} disabled={busy}
            className="press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-50"
            style={think
              ? { borderColor: `${C.purple}55`, background: `${C.purple}1a`, color: C.purple }
              : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.06)', color: 'rgba(235,235,245,0.62)' }}>
            <Brain size={12} /> Reasoning {think ? 'on' : 'off'}
          </motion.button>
          {messages.length > 0 && (
            <motion.button whileTap={TAP} transition={SPRING} onClick={clear}
              className="press inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.06] px-3 py-1.5 text-[12px] text-jtext hover:text-textb">
              <Trash2 size={12} /> Clear
            </motion.button>
          )}
        </div>
      </div>

      {/* Offline explainer — this only ever works against the local machine */}
      {online === false && (
        <GlassCard padding="p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} style={{ color: C.urg }} className="mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-jtext leading-relaxed">
              <span className="text-textb font-medium">No local model reachable at {host || '127.0.0.1:11434'}.</span>{' '}
              Start it with <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px]">ollama serve</code>.
              This section talks only to your own machine — on the deployed site it stays offline unless Ollama is exposed through the tunnel.
            </div>
          </div>
        </GlassCard>
      )}

      {/* Transcript */}
      <GlassCard padding="" className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-10">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: `${C.blue}1a`, border: `1px solid ${C.blue}33` }}>
                <Cpu size={24} style={{ color: C.blue }} />
              </div>
              <div>
                <div className="text-[17px] font-semibold text-textb tracking-[-0.02em]">Ask Jarvis anything</div>
                <div className="text-[13px] text-dimtext mt-1.5 max-w-sm">
                  Running on your own hardware, with your live pipeline as context. Nothing leaves this machine.
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-md">
                {SUGGESTIONS.map(s => (
                  <motion.button key={s} whileTap={TAP} transition={SPRING} onClick={() => send(s)} disabled={online === false}
                    className="press text-left rounded-xl border border-border bg-white/[0.05] px-4 py-2.5 text-[13px] text-jtext hover:bg-white/10 hover:text-textb disabled:opacity-40"
                    style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                    <Sparkles size={12} className="inline mr-2 -mt-px" style={{ color: C.blue }} />{s}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={m.role === 'user' ? 'max-w-[80%]' : 'max-w-[88%] w-full'}>
                    {m.role === 'assistant' && m.thinking && (
                      <button onClick={() => setOpenThink(o => ({ ...o, [i]: !o[i] }))}
                        className="tap mb-2 inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1"
                        style={{ background: `${C.purple}14`, color: C.purple }}>
                        <Brain size={11} />
                        {openThink[i] ? 'Hide reasoning' : 'Show reasoning'}
                        <ChevronDown size={11} style={{ transform: openThink[i] ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
                      </button>
                    )}
                    <AnimatePresence initial={false}>
                      {m.role === 'assistant' && m.thinking && openThink[i] && (
                        <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                          className="mb-2 overflow-hidden whitespace-pre-wrap text-[12px] leading-relaxed rounded-xl p-3 text-dimtext"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', fontFamily: 'inherit' }}>
                          {m.thinking.trim()}
                        </motion.pre>
                      )}
                    </AnimatePresence>

                    {(m.content || m.role === 'user') && (
                      <div className="rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap"
                        style={m.role === 'user'
                          ? { background: `${C.blue}22`, border: `1px solid ${C.blue}3d`, color: '#f5f5f7' }
                          : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(235,235,245,0.88)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' }}>
                        {m.content || '…'}
                      </div>
                    )}

                    {busy && i === messages.length - 1 && m.role === 'assistant' && !m.content && (
                      <div className="flex items-center gap-2 text-[12px] text-dimtext mt-1.5 px-1">
                        <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }}
                          animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity }} />
                        {think ? 'reasoning…' : 'thinking…'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {err && (
          <div className="mx-5 mb-3 rounded-xl px-3.5 py-2.5 text-[12px] flex-shrink-0"
            style={{ background: `${C.urg}14`, border: `1px solid ${C.urg}33`, color: '#ff8a80' }}>
            {err}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border p-4 flex-shrink-0">
          <div className="flex items-end gap-2.5">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder={online === false ? 'Start Ollama to chat…' : 'Ask about your pipeline, deals, or what to do next…'}
              disabled={online === false}
              onChange={e => { setInput(e.target.value); grow(e.target); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              className="flex-1 resize-none bg-transparent text-[14px] text-textb placeholder:text-dimtext outline-none max-h-[168px] leading-relaxed disabled:opacity-50"
            />
            {busy ? (
              <motion.button whileTap={TAP} transition={SPRING} onClick={stop}
                className="press flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: `${C.urg}22`, border: `1px solid ${C.urg}44`, color: C.urg }} title="Stop">
                <Square size={13} />
              </motion.button>
            ) : (
              <motion.button whileTap={TAP} transition={SPRING} onClick={() => send(input)}
                disabled={!input.trim() || online === false}
                className="press flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30"
                style={{ background: input.trim() ? C.blue : 'rgba(255,255,255,0.08)', color: input.trim() ? '#fff' : 'rgba(235,235,245,0.4)' }}
                title="Send">
                <ArrowUp size={15} />
              </motion.button>
            )}
          </div>
          <div className="text-[11px] text-dimtext mt-2">
            Enter to send · Shift+Enter for a new line · runs locally on your Mac
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
