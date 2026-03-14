'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Lightbulb, ArrowRight } from 'lucide-react';
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
  { key: 'idea',      label: 'Backlog',      color: '#60a5fa' },
  { key: 'prompt',    label: 'In Review',    color: '#a78bfa' },
  { key: 'building',  label: 'Building',     color: '#fbbf24' },
  { key: 'completed', label: 'Shipped',      color: '#4ade80' },
];

const PRIORITY_COLORS: Record<string, string> = {
  high:   '#f87171',
  medium: '#fb923c',
  low:    '#52526e',
};

const CATEGORY_COLORS: Record<string, string> = {
  automation:  '#60a5fa',
  crm:         '#4ade80',
  cost_saving: '#fbbf24',
  revenue:     '#a78bfa',
  personal:    '#52526e',
};

export function IdeasLab() {
  const { refreshKey } = useApp();
  const [ideas,    setIdeas]    = useState<Idea[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({
    title: '', description: '', category: 'automation', priority: 'medium', status: 'idea',
  });

  useEffect(() => {
    supabase.from('jarvis_ideas').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setIdeas(data || []));
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
        <div>
          <h2 className="text-[15px] font-semibold text-textb flex items-center gap-2">
            <Lightbulb size={15} className="text-npurple" />
            Ideas Lab
          </h2>
          <p className="text-[11px] text-dimtext mt-0.5">{ideas.length} total ideas</p>
        </div>
        <motion.button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg"
          style={{ background: 'rgba(167,139,250,0.10)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.20)' }}
          whileHover={{ background: 'rgba(167,139,250,0.16)' }}
          whileTap={{ scale: 0.97 }}
        >
          <Plus size={13} /> New Idea
        </motion.button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-xl p-5"
              style={{ background: 'rgba(18,19,32,0.9)', border: '1px solid rgba(167,139,250,0.18)' }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <input
                  placeholder="Idea title..."
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="col-span-full rounded-lg px-3 py-2.5 text-[12px] text-jtext placeholder-dimtext focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <textarea
                  placeholder="Description..."
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className="col-span-full rounded-lg px-3 py-2.5 text-[12px] text-jtext placeholder-dimtext focus:outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <select
                  value={form.category}
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  className="rounded-lg px-3 py-2.5 text-[12px] text-jtext focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {['automation','crm','cost_saving','revenue','personal'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={form.priority}
                  onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                  className="rounded-lg px-3 py-2.5 text-[12px] text-jtext focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {['high','medium','low'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  className="px-4 py-2 text-[11px] font-medium rounded-lg"
                  style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}
                >
                  Save Idea
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-[11px] font-medium rounded-lg text-dimtext"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kanban board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map(col => {
          const colIdeas = ideas.filter(i => i.status === col.key);
          return (
            <div
              key={col.key}
              className="rounded-xl overflow-hidden flex flex-col"
              style={{ background: 'rgba(18,19,32,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {/* Column header */}
              <div
                className="px-4 py-3 flex items-center justify-between flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                  <span className="text-[11px] font-semibold" style={{ color: col.color }}>{col.label}</span>
                </div>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ background: `${col.color}12`, color: col.color }}
                >
                  {colIdeas.length}
                </span>
              </div>

              {/* Cards */}
              <div className="p-3 flex flex-col gap-2.5 min-h-[100px] max-h-[400px] overflow-y-auto">
                <AnimatePresence>
                  {colIdeas.map((idea, i) => (
                    <motion.div
                      key={idea.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: i * 0.04 }}
                      className="rounded-lg p-3 group cursor-default"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                      whileHover={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      <div className="text-[12px] font-medium text-textb mb-1.5 leading-snug">{idea.title}</div>
                      {idea.description && (
                        <div className="text-[10px] text-dimtext leading-relaxed mb-2.5 line-clamp-2">{idea.description}</div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <span
                          className="text-[8px] font-medium px-1.5 py-0.5 rounded-full capitalize"
                          style={{
                            background: `${CATEGORY_COLORS[idea.category] || '#52526e'}10`,
                            color: CATEGORY_COLORS[idea.category] || '#52526e',
                          }}
                        >
                          {idea.category}
                        </span>
                        <span
                          className="text-[8px] font-medium px-1.5 py-0.5 rounded-full capitalize"
                          style={{
                            background: `${PRIORITY_COLORS[idea.priority] || '#52526e'}10`,
                            color: PRIORITY_COLORS[idea.priority] || '#52526e',
                          }}
                        >
                          {idea.priority}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {colIdeas.length === 0 && (
                  <div className="text-[9px] text-dimtext text-center py-6 italic">Empty</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
