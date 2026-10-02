import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './reaction-mobile.css';
import { installImagePickerFix } from './lib/imagePickerFix';
import { installChatComposerFocus } from './lib/chatComposerFocus';
import { installSlashSnippetEnhancer } from './lib/slashSnippetEnhancer';

installImagePickerFix();
installChatComposerFocus();
installSlashSnippetEnhancer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(() => {});
  });
}
