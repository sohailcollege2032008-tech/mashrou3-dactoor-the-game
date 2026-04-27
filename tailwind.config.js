/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Legacy (kept during transition) ──────────────────────
        background: '#0A0E1A',
        primary: '#00F5A0',
        secondary: '#00D4FF',
        warning: '#FFB800',
        choice: { A: '#FF6B6B', B: '#4ECDC4', C: '#FFE66D', D: '#A78BFA' },

        // ── New editorial design system ───────────────────────────
        paper:    { DEFAULT: '#F4F1EA', 2: '#EDE8DB', 3: '#E4DDCC' },
        ink:      { DEFAULT: '#1A1A1A', 2: '#3B3B38', 3: '#6F6C63', 4: '#9E9B90' },
        rule:     { DEFAULT: '#C9C2B1', strong: '#1A1A1A' },
        burgundy: { DEFAULT: '#9C3B2E', 2: '#7A2D22' },
        navy:     { DEFAULT: '#2D3E5C', 2: '#1F2D47' },
        gold:     '#B08944',
        success:  '#3C6E47',
        alert:    '#B5432C',
        // per-choice in editorial system
        'choice-a': '#9C3B2E',
        'choice-b': '#2D3E5C',
        'choice-c': '#B08944',
        'choice-d': '#3C6E47',
      },
      fontFamily: {
        // Legacy
        sans:    ['Cairo', 'sans-serif'],
        display: ['Clash Display', 'sans-serif'],
        // New
        serif:   ['Fraunces', 'Georgia', 'serif'],
        editorial: ['Inter Tight', 'system-ui', 'sans-serif'],
        arabic:  ['IBM Plex Sans Arabic', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        xs:   '2px',
        sm:   '4px',
        md:   '6px',
        lg:   '10px',
        full: '999px',
      },
      boxShadow: {
        1: '0 1px 2px rgba(26,26,26,0.06)',
        2: '0 2px 8px rgba(26,26,26,0.08), 0 1px 2px rgba(26,26,26,0.05)',
        3: '0 12px 32px rgba(26,26,26,0.12), 0 2px 6px rgba(26,26,26,0.06)',
      },
    },
  },
  plugins: [],
}
