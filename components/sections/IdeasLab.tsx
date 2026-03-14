'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Lightbulb } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/lib/AppContext';

interface Idea {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

const COLUMNS = [
  { key: 'idea',       label: 'New Ideas',    color: '#00aaff' },
  { key: 'prompt',     label: 'Prompt Ready', color: '#aa44ff' },
  { key: 'building',   label: 'In Progress',  color: '#ffd700' },
  { key: 'completed',  label: 'Done',         color: '#00ff88' },
];

export function IdeasLab() {
  const { refreshKey } = useApp();
  const [ideas,    setIdeas]    = useState<Idea[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({ title: '', description: '', category: 'automation', priority: 'medium', status: 'idea' });

  useEffect(() => {
    supabase.from('jarvis_ideas').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setIdeas(data || []); setLoading(false); });
  }, [refreshKey]);

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    const { data } = await supabase.from('jarvis_ideas').insert([form]).select().single();
    if (data) setIdeas(prev => [data, ...prev]);
    setForm({ title: '', description: '', category: 'automation', priority: 'medium', status: 'idea' });
    setShowForm(false);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-npurple" />
          <span className="font-orbitron text-[12px] text-npurple tracking-[2px]">IDEAS LAB</span>
        </div>
        <motion.button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono border rounded-sm"
          style={{ borderColor: '#aa44ff40', color: '#aa44ff', background: '#aa44ff10' }}
          whileHover={{ background: '#aa44ff1a' }}
        >
          <Plus size={12} /> New Idea
        </motion.button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <GlassCard accent="purple" padding="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <input
                  placeholder="Idea title..."
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="col-span-full bg-bg3 border border-border2 rounded-sm px-3 py-2 text-[11px] font-mono text-jtext placeholder-dimtext focus:outline-none focus:border-npurple/50"
                />
                <textarea
                  placeholder="Description..."
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className="col-span-full bg-bg3 border border-border2 rounded-sm px-3 py-2 text-[11px] font-mono text-jtext placeholder-dimtext focus:outline-none focus:border-npurple/50 resize-none"
                />
                <select
                  value={form.category}
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  className="bg-bg3 border border-border2 rounded-sm px-3 py-2 text-[11px] font-mono text-jtext focus:outline-none"
                >
                  {['automation','crm','cost_saving','revenue','personal'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={form.priority}
                  onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                  className="bg-bg3 border border-border2 rounded-sm px-3 py-2 text-[11px] font-mono text-jtext focus:outline-none"
                >
                  {['high','medium','low'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAdd} className="px-4 py-1.5 text-[10px] font-mono border rounded-sm" style={{ borderColor: '#aa44ff40', color: '#aa44ff', background: '#aa44ff10' }}>Save Idea</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-[10px] font-mono border border-border2 rounded-sm text-dimtext">Cancel</button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kanban board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map(col => {
          const colIdeas = ideas.filter(i => i.status === col.key);
          return (
            <div key={col.key} className="rounded-sm border border-border2 overflow-hidden" style={{ background: 'rgba(10,10,20,0.8)' }}>
              {/* Column header */}
              <div className="px-3 py-2.5 border-b border-border2 flex items-center justify-between" style={{ background: `${col.color}08` }}>
                <span className="font-orbitron text-[9px] font-bold tracking-[1.5px] uppercase" style={{ color: col.color }}>{col.label}</span>
                <span className="font-orbitron text-[11px] text-dimtext">{colIdeas.length}</span>
              </div>

              {/* Ideas */}
              <div className="p-2 flex flex-col gap-2 min-h-[120px] max-h-[420px] overflow-y-auto">
                <AnimatePresence>
                  {colIdeas.map(idea => (
                    <motion.div
                      key={idea.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-bg2 border border-border2 rounded-sm p-2.5"
                    >
                      <div className="text-[11px] text-textb font-bold mb-1 leading-tight">{idea.title}</div>
                      {idea.description && (
                        <div className="text-[9px] text-dimtext leading-relaxed mb-2 line-clamp-2">{idea.description}</div>
                      )}
                      <div className="flex flex-wrap gap-1">
                        <span className={`idea-badge badge-${idea.category} text-[8px] px-1.5 py-0.5 rounded-sm font-orbitron tracking-[.5px]`}>{idea.category}</span>
                        <span className={`idea-badge badge-${idea.priority} text-[8px] px-1.5 py-0.5 rounded-sm font-orbitron tracking-[.5px]`}>{idea.priority}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {colIdeas.length === 0 && (
                  <div className="text-[9px] text-dimtext italic text-center py-4">Empty</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
