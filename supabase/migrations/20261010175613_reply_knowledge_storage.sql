-- Canonical knowledge lives in Order System. Browser access goes through staff auth.
create table public.reply_knowledge (
 id uuid primary key default gen_random_uuid(), import_key text unique,
 version integer not null default 1, draft jsonb not null,
 published jsonb, published_version integer, updated_by text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.reply_knowledge_events (
 id bigint generated always as identity primary key, article_id uuid references public.reply_knowledge(id),
 action text not null, actor text not null, version integer not null, snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create table public.reply_style (
 channel text primary key check(channel in ('whatsapp','shopee')),
 enabled boolean not null default true, samples integer not null default 0,
 counts jsonb not null default '{}', preferences jsonb not null default '{}',
 version integer not null default 1, updated_at timestamptz not null default now()
);
insert into public.reply_style(channel) values ('whatsapp'),('shopee');
create table public.reply_suggestion_latest (
 conversation_id uuid primary key, inbound_revision text not null, text text not null,
 article_id uuid references public.reply_knowledge(id), article_version integer,
 created_at timestamptz not null default now()
);
create table public.reply_style_receipts (
 message_id uuid primary key, channel text not null, learned boolean not null,
 created_at timestamptz not null default now()
);
create table public.reply_wording (
 article_id uuid references public.reply_knowledge(id), article_version integer not null,
 channel text not null, text text not null check(length(text)<=4000),
 uses integer not null default 1, updated_at timestamptz not null default now(),
 primary key(article_id,article_version,channel)
);
create index reply_knowledge_published on public.reply_knowledge(updated_at desc) where published is not null;
create index reply_style_receipts_age on public.reply_style_receipts(created_at);
create index reply_suggestion_latest_age on public.reply_suggestion_latest(created_at);
alter table public.reply_knowledge enable row level security;
alter table public.reply_knowledge_events enable row level security;
alter table public.reply_style enable row level security;
alter table public.reply_suggestion_latest enable row level security;
alter table public.reply_style_receipts enable row level security;
alter table public.reply_wording enable row level security;
revoke all on public.reply_knowledge,public.reply_knowledge_events,public.reply_style,public.reply_suggestion_latest,public.reply_style_receipts,public.reply_wording from anon,authenticated;
grant all on public.reply_knowledge,public.reply_knowledge_events,public.reply_style,public.reply_suggestion_latest,public.reply_style_receipts,public.reply_wording to service_role;

