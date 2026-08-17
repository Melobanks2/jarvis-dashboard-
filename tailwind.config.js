/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // surfaces — deep blue-cast base; panels are translucent white
        // washes so everything reads as glass over the ambient field.
        bg:     '#05070d',
        bg2:    'rgba(255,255,255,0.05)',
        bg3:    'rgba(255,255,255,0.07)',
        bg4:    'rgba(255,255,255,0.10)',
        // accents — Apple system colors, blue-first.
        // blue = identity/info · green = positive/money · red = urgent
        // · orange = warning/aging. gold aliases to orange.
        ngreen: '#30d158',
        ngold:  '#ff9f0a',
        nred:   '#ff453a',
        norange:'#ff9f0a',
        nblue:  '#0a84ff',
        npurple:'#bf5af2',
        ncyan:  '#64d2ff',
        // text — Apple label hierarchy on dark
        ndim:   'rgba(235,235,245,0.18)',
        dimtext:'rgba(235,235,245,0.35)',
        jtext:  'rgba(235,235,245,0.62)',
        textb:  '#f5f5f7',
        // borders — `border` was referenced 12x but never defined, so those
        // divider lines rendered as nothing. Defined now.
        border: 'rgba(255,255,255,0.08)',
        jborder:'rgba(255,255,255,0.08)',
        border2:'rgba(255,255,255,0.14)',
      },
      fontFamily: {
        // Orbitron retired — resolves to the system stack so every legacy
        // font-orbitron callsite instantly loses the sci-fi face.
        orbitron: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'sans-serif'],
        spacemono: ['var(--font-space-mono)', 'monospace'],
        dmsans:   ['var(--font-dm-sans)', 'sans-serif'],
        mono:     ['SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
        sans:     ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'sans-serif'],
      },
      animation: {
        blink:       'blink 3s ease-in-out infinite',
        float:       'float 4s ease-in-out infinite',
        'pulse-ring':'pulse-ring 3s ease-in-out infinite',
        marquee:     'marquee 45s linear infinite',
        'fade-in':   'fadeIn .4s ease-out',
      },
      keyframes: {
        blink:      { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'pulse-ring':{ '0%': { transform: 'scale(0.92)', opacity: '0.5' }, '50%': { transform: 'scale(1.08)', opacity: '0.12' }, '100%': { transform: 'scale(0.92)', opacity: '0.5' } },
        marquee:    { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        fadeIn:     { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
