import { useState } from 'react';
import './ChannelInbox.css';

type Props = { active: boolean };

export default function ChannelInbox({ active }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return <section
    className={`channel-inbox${expanded ? ' channel-inbox-expanded' : ''}`}
    aria-label="Channel / Inbox"
    hidden={!active}
  >
    <div className="channel-inbox-toolbar">
      <div className="channel-inbox-heading">
        <strong>Channel / Inbox</strong>
        <span>WhatsApp & Shopee</span>
      </div>
      <div className="channel-inbox-actions">
        <button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Kecilkan' : 'Fullscreen'}
        </button>
        <a href="/inbox/" target="_blank" rel="noopener noreferrer">Buka tab baharu ↗</a>
      </div>
    </div>
    <div className="channel-inbox-frame">
      {!loaded && <div className="channel-inbox-loading" role="status">Memuatkan Inbox...</div>}
      <iframe
        title="Unified Inbox ICETAK"
        src="/inbox/"
        allow="clipboard-write; fullscreen"
        referrerPolicy="same-origin"
        onLoad={() => setLoaded(true)}
      />
    </div>
  </section>;
}
