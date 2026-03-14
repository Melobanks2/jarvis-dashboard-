'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, ChevronDown } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: Date;
}

const AGENTS = [
  { name: 'Jarvis',         color: '#ffd700', desc: 'Chief of Staff — knows everything',        avatar: '👑' },
  { name: 'David Caller',   color: '#00ff88', desc: 'AI Caller — call logs & seller insights',  avatar: '📞' },
  { name: 'Lead Analyzer',  color: '#00aaff', desc: 'Analyzes leads & motivation scores',       avatar: '🔍' },
  { name: 'Data Agent',     color: '#aa44ff', desc: 'Pipeline stats & CRM data',                avatar: '📊' },
];

export function AgentChat() {
  const [agent,    setAgent]    = useState(AGENTS[0]);
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'assistant', content: `Hello! I'm ${AGENTS[0].name}. How can I assist you with your wholesale operations today?`, ts: new Date() },
  ]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectAgent = (a: typeof AGENTS[0]) => {
    setAgent(a);
    setMessages([{ id: Date.now().toString(), role: 'assistant', content: `Hello! I'm ${a.name}. ${a.desc}. What do you need?`, ts: new Date() }]);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input, ts: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: data.message || 'No response.', ts: new Date() }]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Connection error. Please try again.', ts: new Date() }]);
    }
    setLoading(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-200px)]">

      {/* Agent selector */}
      <div className="lg:w-64 flex lg:flex-col gap-2">
        <div className="font-orbitron text-[9px] tracking-[2px] text-dimtext uppercase mb-1 hidden lg:block">Select Agent</div>
        {AGENTS.map(a => (
          <button
            key={a.name}
            onClick={() => selectAgent(a)}
            className="flex items-center gap-3 p-3 rounded-sm border text-left transition-all"
            style={{
              background:   agent.name === a.name ? `${a.color}12` : 'rgba(12,12,24,0.6)',
              borderColor:  agent.name === a.name ? `${a.color}40` : '#1e1e3a',
            }}
          >
            <span className="text-[20px] flex-shrink-0">{a.avatar}</span>
            <div className="min-w-0 flex-1">
              <div className="font-orbitron text-[11px] font-bold truncate" style={{ color: a.color }}>{a.name}</div>
              <div className="text-[9px] text-dimtext line-clamp-1">{a.desc}</div>
            </div>
            {agent.name === a.name && (
              <StatusDot status="online" size="sm" />
            )}
          </button>
        ))}
      </div>

      {/* Chat window */}
      <div className="flex-1 flex flex-col min-h-0">
        <GlassCard accent="cyan" padding="" className="flex-1 flex flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border2" style={{ background: `${agent.color}08` }}>
            <span className="text-[22px]">{agent.avatar}</span>
            <div>
              <div className="font-orbitron text-[12px] font-bold" style={{ color: agent.color }}>{agent.name}</div>
              <div className="text-[9px] text-dimtext">{agent.desc}</div>
            </div>
            <div className="ml-auto"><StatusDot status="online" label="Online" size="sm" /></div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {messages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Avatar */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[12px]"
                    style={{ background: msg.role === 'user' ? '#00aaff20' : `${agent.color}20`, border: `1px solid ${msg.role === 'user' ? '#00aaff30' : `${agent.color}30`}` }}
                  >
                    {msg.role === 'user' ? <User size={12} className="text-nblue" /> : agent.avatar}
                  </div>

                  {/* Bubble */}
                  <div
                    className="max-w-[72%] px-3 py-2 rounded-sm text-[11px] leading-relaxed"
                    style={{
                      background:  msg.role === 'user' ? 'rgba(0,170,255,.12)' : `${agent.color}10`,
                      border:      `1px solid ${msg.role === 'user' ? 'rgba(0,170,255,.2)' : `${agent.color}20`}`,
                      color:       msg.role === 'user' ? '#dde6f8' : '#b8c0d8',
                    }}
                  >
                    {msg.content}
                    <div className="text-[8px] text-dimtext mt-1">
                      {msg.ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px]" style={{ background: `${agent.color}20`, border: `1px solid ${agent.color}30` }}>
                  {agent.avatar}
                </div>
                <div className="px-4 py-2 rounded-sm" style={{ background: `${agent.color}10`, border: `1px solid ${agent.color}20` }}>
                  <div className="flex gap-1.5">
                    {[0,1,2].map(i => (
                      <motion.div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: agent.color }}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-border2">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Ask ${agent.name} anything...`}
                rows={1}
                className="flex-1 bg-bg3 border border-border2 rounded-sm px-3 py-2 text-[11px] font-mono text-jtext placeholder-dimtext focus:outline-none focus:border-ncyan/40 resize-none transition-colors"
                style={{ maxHeight: 80 }}
              />
              <motion.button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="w-9 h-9 rounded-sm flex items-center justify-center disabled:opacity-40 flex-shrink-0"
                style={{ background: `${agent.color}20`, border: `1px solid ${agent.color}40`, color: agent.color }}
                whileHover={{ background: `${agent.color}30` }}
                whileTap={{ scale: 0.95 }}
              >
                <Send size={14} />
              </motion.button>
            </div>
            <div className="text-[8px] text-dimtext mt-1">Enter to send • Shift+Enter for new line</div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
