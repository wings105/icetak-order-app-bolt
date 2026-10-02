/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        wa: {
          green: '#00a884',
          'green-dark': '#008069',
          'green-light': '#d9fdd3',
          bg: '#efeae2',
          sidebar: '#f0f2f5',
          chat: '#202c33',
          'chat-dark': '#111b21',
          border: '#e9edef',
          'border-dark': '#2a3942',
          text: '#111b21',
          'text-secondary': '#667781',
          'text-dark': '#e9edef',
          'text-secondary-dark': '#8696a0',
        },
      },
    },
  },
  plugins: [],
};

