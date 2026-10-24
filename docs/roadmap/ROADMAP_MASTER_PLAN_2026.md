# iCetak — Master Product Roadmap & Feature Specifications

> Baseline: 23 October 2026 (MYT). Source: discussions of iCetak workflow, Shopee keyword/Ads APIs, stock POD, ClickUp workspace, Admin V2, Inbox, Finance and design automation.
> This file is an implementation reference, **not** evidence that every feature is shipped. Do not put API secrets, customer data or access tokens here.

## Status and evidence rules
- `idea`: exploratory; no shipping claim.
- `planned`: intent, scope and acceptance criteria identified; not yet proven implemented.
- `building`: feature is under development, no assumption of deployed access.
- `testing`: repository/backend/controlled QA exists or user reports partial rollout, but owner-hosted end-to-end proof is incomplete.
- `completed`: verified task objective exists. Production deployment and owner acceptance should be documented.
- Percentage in board is a **planning-stage indicator**, not a measured delivery SLA. Owner can update progress after milestone confirmation.
- `private` items are hidden from public roadmap even though high-level, non-sensitive planning context can appear in this repository.
- Search volume is Shopee's rolling 30-day *keyword-level* search figure, not iCetak product traffic nor a direct measure of trend growth.

## Architecture and source of truth
- Production repo: `wings105/icetak-order-app-bolt`, branch `production`; Cloudflare frontend; Admin V2.
- Roadmap data: Supabase Order System, tables `public.icetak_roadmap_items` and `public.icetak_roadmap_updates` with RLS.
- `reference_url` links each roadmap card to this document's fixed anchor.
- Shopee Ads API read-only tests have succeeded; mass scans, stock writes and Ads edits require separate safety approvals.
- Existing modules must retain their native production contracts; new features do not silently overwrite them.

## Roadmap index
| ID | Feature | Area | Priority | Baseline state | Visibility |
|---|---|---|---|---|---|
| [IC-001](#ic-001) | iCetak Roadmap Portal v1 | infrastructure | P1 | completed | Public |
| [IC-002](#ic-002) | Shopee Ads API Read-Only Validation | shopee | P1 | completed | Public |
| [IC-003](#ic-003) | Shopee Keyword Intelligence | shopee | P1 | planned | Public |
| [IC-004](#ic-004) | SEO Product Optimizer | shopee | P1 | planned | Public |
| [IC-005](#ic-005) | Keyword Opportunity Finder | shopee | P2 | planned | Public |
| [IC-006](#ic-006) | Seasonal Trend Radar | shopee | P2 | planned | Public |
| [IC-007](#ic-007) | Shopee Ads Profit Analyzer | finance | P1 | planned | Owner only |
| [IC-008](#ic-008) | Shopee Ads Performance Dashboard | shopee | P2 | planned | Public |
| [IC-009](#ic-009) | Product Performance Ranking | shopee | P2 | planned | Public |
| [IC-010](#ic-010) | Shopee Keyword Batch Scanner | automation | P2 | planned | Public |
| [IC-011](#ic-011) | Shopee Product ID / SKU Catalog Sync | shopee | P1 | testing | Public |
| [IC-012](#ic-012) | Shopee Stock POD Auto Refill | automation | P1 | planned | Public |
| [IC-013](#ic-013) | POD Stock Refill Safety Guard | automation | P1 | planned | Owner only |
| [IC-014](#ic-014) | ClickUp Task Sidepanel | orders | P1 | testing | Public |
| [IC-015](#ic-015) | Original Resolution Image Copy | design | P1 | testing | Public |
| [IC-016](#ic-016) | Print AWB & Reference Quick Actions | orders | P1 | testing | Public |
| [IC-017](#ic-017) | ClickUp Review & Status Dropdown | orders | P1 | testing | Public |
| [IC-018](#ic-018) | AI Action Dashboard | inbox | P1 | testing | Public |
| [IC-019](#ic-019) | Designer Paste Image to ClickUp | design | P1 | testing | Public |
| [IC-020](#ic-020) | Unified Inbox Product & Order Cards | inbox | P2 | testing | Public |
| [IC-021](#ic-021) | Unified Inbox Order Lifecycle & Search | inbox | P1 | testing | Public |
| [IC-022](#ic-022) | AI Inline Reply Suggestions | inbox | P1 | testing | Public |
| [IC-023](#ic-023) | WhatsApp Username CRM & Identity | inbox | P2 | planned | Owner only |
| [IC-024](#ic-024) | Draft Follow-Up & Shopee Auto Cancel | automation | P2 | testing | Owner only |
| [IC-025](#ic-025) | QRPay Match: Tambah Tarikh | finance | P1 | planned | Owner only |
| [IC-026](#ic-026) | QRPay / Pickup Counter Rollout | finance | P1 | testing | Owner only |
| [IC-027](#ic-027) | Material Stock Reservation & Deduction | production | P1 | testing | Public |
| [IC-028](#ic-028) | Acrylic Production View | production | P2 | testing | Public |
| [IC-029](#ic-029) | SKU Template Renderer Automation | design | P1 | planned | Public |
| [IC-030](#ic-030) | AI Vision Quality Control | design | P2 | idea | Public |
| [IC-031](#ic-031) | Smart Photo Collage Engine | design | P2 | idea | Public |
| [IC-032](#ic-032) | Remove Background Internal Tool | design | P3 | idea | Public |
| [IC-033](#ic-033) | Edible Sheet Quote Calculator | orders | P2 | planned | Public |
| [IC-034](#ic-034) | Branded Short URLs | infrastructure | P3 | planned | Public |
| [IC-035](#ic-035) | Order Detail Completeness Scanner | automation | P1 | planned | Owner only |
| [IC-036](#ic-036) | Inbox 30-Min Missing Detail Follow-Up | automation | P2 | testing | Owner only |
| [IC-037](#ic-037) | ClickUp AI Design Routing | design | P2 | planned | Public |
| [IC-038](#ic-038) | Shopee Finance Order Contribution KPI | finance | P2 | testing | Owner only |
| [IC-039](#ic-039) | Roadmap Feedback, Voting & Releases | infrastructure | P3 | planned | Public |
| [IC-040](#ic-040) | WhatsApp/Shopee Draft-to-Order Integration | orders | P2 | testing | Owner only |
| [IC-041](#ic-041) | Roadmap Documentation Reference Links | infrastructure | P2 | testing | Public |

| [IC-072](#ic-072) | Daily Business Report + WhatsApp Admin | finance | P1 | in progress | Owner only |
| [IC-073](#ic-073) | Channel Profitability, Shipping P&L & Pricing Strategy | finance | P1 | planned | Owner only |
| [IC-074](#ic-074) | Source Attribution & Cost Reconciliation | finance | P1 | planned | Owner only |

## Feature contracts

<a id="ic-001"></a>
### IC-001 — iCetak Roadmap Portal v1

- **Area:** infrastructure
- **Priority:** P1
- **Baseline status:** completed
- **Public roadmap:** Yes
- **Outcome:** Halaman roadmap SaaS, board status, carian, kategori, kemas kini progres dan changelog; owner boleh urus item.
- **Scope:** Halaman /roadmap dan panel pengurusan owner dengan kawalan paparan umum/private.
- **Evidence/status note:** Pemilik menyatakan halaman sudah boleh dibuka selepas pembetulan production branch pada 23 Okt 2026.
- **Acceptance criteria:**
  - [ ] Laman roadmap responsif berfungsi pada desktop dan telefon.
  - [ ] Owner boleh tambah, edit dan tukar status tanpa menyentuh order pelanggan.
  - [ ] Paparan umum hanya membaca item yang diterbitkan melalui RLS.
  - [ ] Changelog mengekalkan sejarah nota perkembangan.
- **Related existing documentation:**
  - [docs/roadmap/ROADMAP_MASTER_PLAN_2026.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/roadmap/ROADMAP_MASTER_PLAN_2026.md)

<a id="ic-002"></a>
### IC-002 — Shopee Ads API Read-Only Validation

- **Area:** shopee
- **Priority:** P1
- **Baseline status:** completed
- **Public roadmap:** Yes
- **Outcome:** Akses sebenar Shopee Ads API disahkan, termasuk keyword 30 hari, cadangan produk dan prestasi iklan.
- **Scope:** Ujian read-only untuk endpoint keyword, recommended item, campaign dan Ads reporting; bukan automasi iklan.
- **Evidence/status note:** 10 endpoint Ads telah memberikan HTTP 200 tanpa ralat Shopee pada 23 Okt 2026; item Pinkfong, Edible dan Acrylic diuji.
- **Acceptance criteria:**
  - [ ] Keyword produk boleh dibaca daripada item_id sebenar.
  - [ ] Data search_volume, quality_score dan suggested_bid dipulangkan.
  - [ ] Laporan kempen harian dan jam diterima.
  - [ ] Tiada stok, harga atau iklan diubah ketika ujian.

<a id="ic-003"></a>
### IC-003 — Shopee Keyword Intelligence

- **Area:** shopee
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Keyword, search volume 30 hari, quality score dan suggested bid mengikut setiap produk Shopee iCetak.
- **Scope:** Modul analisis keyword setiap Product ID di katalog; simpan snapshot sejarah dengan masa, sumber dan status API.
- **Evidence/status note:** Endpoint sudah diuji; dashboard sendiri belum disahkan wujud.
- **Acceptance criteria:**
  - [ ] Pilih produk dan lihat keyword sebenar dalam susunan carian.
  - [ ] Tiada keyword disimulasikan sebagai data Shopee.
  - [ ] Deduplicate keyword antara produk tanpa mencampur relevansi produk.
  - [ ] Gagal/limit API direkod dan boleh retry terkawal.

<a id="ic-004"></a>
### IC-004 — SEO Product Optimizer

- **Area:** shopee
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Cadangkan tajuk, deskripsi dan keyword Shopee berdasarkan data carian serta jualan produk sebenar.
- **Scope:** Audit batch 20–50 produk utama dahulu, pembetulan SEO dicadangkan untuk review manual.
- **Evidence/status note:** Cadangan perancangan 23 Okt 2026, belum dilaksanakan.
- **Acceptance criteria:**
  - [ ] Banding tajuk asal dengan keyword disyorkan dan search volume.
  - [ ] Cadangan mengekalkan atribut produk yang betul seperti saiz, print-only dan proses.
  - [ ] Paparkan before/after dan alasan, bukan auto-edit tanpa kelulusan.
  - [ ] Banding prestasi sebelum dan selepas sekurang-kurangnya satu kitaran data.

<a id="ic-005"></a>
### IC-005 — Keyword Opportunity Finder

- **Area:** shopee
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Cari jurang keyword yang relevan tetapi tidak digunakan pada produk iCetak.
- **Scope:** Jadual keyword → produk sesuai → jurang tajuk/deskripsi → potensi tindakan.
- **Evidence/status note:** Dirancang dalam perbincangan SEO/Ads.
- **Acceptance criteria:**
  - [ ] Keyword yang tak relevan tidak dicadang semata-mata kerana volume tinggi.
  - [ ] Tunjukkan produk mana sudah dan belum guna keyword.
  - [ ] Bezakan popular keyword daripada trending keyword.
  - [ ] Sediakan senarai semak untuk tindakan SEO owner.

<a id="ic-006"></a>
### IC-006 — Seasonal Trend Radar

- **Area:** shopee
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Kesan peluang Merdeka, Deepavali, Raya, Krismas dan acara lain sebelum musim permintaan.
- **Scope:** Kalendar acara; pantau keyword bertema mengikut produk berkaitan dan simpan perbandingan snapshot 30 hari.
- **Evidence/status note:** Ujian sebenar Deepavali cake topper memulangkan 1,238 carian dalam 30 hari; bukan bukti trend menaik.
- **Acceptance criteria:**
  - [ ] Acara bermusim dipantau 6–8 minggu lebih awal.
  - [ ] Istilah Deepavali/Diwali dan kategori topper/edible diuji tanpa membuat kesimpulan palsu.
  - [ ] Growth dibandingkan dengan snapshot terdahulu dan diberi label proksi 30-day rolling.
  - [ ] Paparkan cadangan tema/design bersama bukti carian sebenar.

<a id="ic-007"></a>
### IC-007 — Shopee Ads Profit Analyzer

- **Area:** finance
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** No (owner only)
- **Outcome:** Padankan prestasi iklan dengan kos produk dan fee Shopee untuk anggar sumbangan untung.
- **Scope:** Ads spend, attributed GMV, kos bahan, fee dan nett dikira mengikut data provider; elak double-count conversion.
- **Evidence/status note:** Ads daily & hourly API berfungsi; model gabungan untung iklan belum diuji.
- **Acceptance criteria:**
  - [ ] Bezakan GMV iklan daripada untung sebenar.
  - [ ] Join dengan kos dan fee menggunakan identiti order/item yang disahkan.
  - [ ] Paparkan direct vs broad attribution berasingan.
  - [ ] Cadang review iklan membazir berdasarkan bukti, tidak auto-pause.
- **Related existing documentation:**
  - [docs/ORDER_FINANCE_DETAIL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_FINANCE_DETAIL.md)

<a id="ic-008"></a>
### IC-008 — Shopee Ads Performance Dashboard

- **Area:** shopee
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Pantau Ads spend, clicks, impressions, CTR, ROAS dan trend kempen produk.
- **Scope:** Dashboard harian/jam daripada Ads API read-only untuk owner menilai kempen.
- **Evidence/status note:** Data 20–22 Okt 2026 tersedia melalui API; UI baharu belum dibina.
- **Acceptance criteria:**
  - [ ] Tarikh MYT dan kempen jelas.
  - [ ] Paparkan click, impression, spend, direct/broad ROAS.
  - [ ] Perbandingan harian dan amaran data tiada.
  - [ ] Tidak campur analisis organik dengan paid Ads.

<a id="ic-009"></a>
### IC-009 — Product Performance Ranking

- **Area:** shopee
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Susun produk mengikut order, margin, kos Ads, trend permintaan dan peluang SEO.
- **Scope:** Ranking menggunakan skor berwajaran dan sumber data yang telus.
- **Evidence/status note:** Dirancang untuk fasa selepas keyword dan Ads cost.
- **Acceptance criteria:**
  - [ ] Tiada markah palsu untuk produk tanpa data.
  - [ ] Ranking pesanan dan margin diasingkan daripada popularity keyword.
  - [ ] Boleh tapis kategori dan julat tarikh.
  - [ ] Pautan terus ke produk/analisis keyword.

<a id="ic-010"></a>
### IC-010 — Shopee Keyword Batch Scanner

- **Area:** automation
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Imbas katalog Shopee iCetak secara berkala dengan rate-limit dan deduplikasi keyword.
- **Scope:** Queue scan per item; selang panggilan, checkpoint dan kos operasi; snapshot mingguan tanpa hammer API.
- **Evidence/status note:** Cadangan struktur untuk 2,004 produk berdasarkan katalog semasa.
- **Acceptance criteria:**
  - [ ] Produk 2,004+ diproses bergilir dan sambung semula selepas gagal.
  - [ ] Laporan last scanned dan status response setiap produk.
  - [ ] Tiada mass scan agresif sebelum limit diketahui.
  - [ ] Deduplicate keyword untuk simpanan cekap.

<a id="ic-011"></a>
### IC-011 — Shopee Product ID / SKU Catalog Sync

- **Area:** shopee
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Padankan Product ID, variasi, SKU, imej dan active status dengan katalog iCetak.
- **Scope:** Gunakan katalog Shopee sedia ada sebagai sumber ID bagi keyword, stock dan product cards.
- **Evidence/status note:** Katalog 2,004 produk dan item ID ada dalam Supabase; operasi tambahan perlu pengesahan.
- **Acceptance criteria:**
  - [ ] Item ID dan model/variation ID konsisten.
  - [ ] Imej product card tersedia dengan fallback yang jelas.
  - [ ] Active/inactive produk dikendalikan.
  - [ ] Sync tidak mencipta pendua pada refresh.
- **Related existing documentation:**
  - [docs/PRODUCT_CATALOG_SUPABASE.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/PRODUCT_CATALOG_SUPABASE.md)

<a id="ic-012"></a>
### IC-012 — Shopee Stock POD Auto Refill

- **Area:** automation
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Stok produk POD ditolak mengikut order dan ditambah semula secara terkawal pada paras minimum.
- **Scope:** Kawalan dalam halaman Produk: baki stok, minimum, target refill dan trigger mengikut setiap item/model.
- **Evidence/status note:** Konsep telah dibincangkan tetapi automasi update_stock production belum diaktifkan.
- **Acceptance criteria:**
  - [ ] Set stok simulasi/operasi bagi setiap produk dan variasi.
  - [ ] Order yang diterima menolak stok sekali sahaja.
  - [ ] Baki mencapai minimum menjadualkan top-up mengikut had yang ditetapkan.
  - [ ] Semua write ke Shopee mempunyai idempotency, audit dan emergency stop.

<a id="ic-013"></a>
### IC-013 — POD Stock Refill Safety Guard

- **Area:** automation
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** No (owner only)
- **Outcome:** Had maksimum refill, amaran lonjakan order dan mod pause untuk elak over-order POD.
- **Scope:** Circuit breaker pada stok min/max, kapasiti harian dan backlog production.
- **Evidence/status note:** Merupakan syarat sebelum live auto refill.
- **Acceptance criteria:**
  - [ ] Refill hanya selepas kira order sebenar dan kapasiti POD.
  - [ ] Hard cap dan stop global disediakan.
  - [ ] Mengesan order duplicate/cancel/return.
  - [ ] Log write Shopee mempunyai status semakan dan rollback manual.

<a id="ic-014"></a>
### IC-014 — ClickUp Task Sidepanel

- **Area:** orders
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Panel kanan untuk task ClickUp: data asal, gambar, SKU, AWB, reference, status dan customer review.
- **Scope:** Gabungkan tindakan paling kerap dalam satu panel tanpa membuka banyak halaman.
- **Evidence/status note:** Dokumen production menyatakan QA controlled verified; user pernah lihat panel dan melaporkan isu image clipboard.
- **Acceptance criteria:**
  - [ ] Panel responsive dan tugas asal kekal dipilih.
  - [ ] Copy SKU/nama/wording dan lihat gambar asal.
  - [ ] Print AWB serta Reference Order terus.
  - [ ] Review customer, tukar status dan Complete Task dengan pengesahan.
- **Related existing documentation:**
  - [docs/TASK_WORKSPACE_SIDE_PANEL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/TASK_WORKSPACE_SIDE_PANEL.md)
  - [docs/TASK_WORKSPACE.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/TASK_WORKSPACE.md)

<a id="ic-015"></a>
### IC-015 — Original Resolution Image Copy

- **Area:** design
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Copy gambar original ClickUp ke Photoshop, bukan thumbnail; elak UI lag ketika salin.
- **Scope:** Fetch imej original dengan had saiz, clipboard PNG dan fallback download bagi fail besar.
- **Evidence/status note:** Dokumen sidepanel mendakwa controlled QA tetapi pengguna melaporkan masalah thumbnail/lag; pengesahan hosted masih diperlukan.
- **Acceptance criteria:**
  - [ ] Copy clipboard guna imej asal, bukan thumbnail resolusi rendah.
  - [ ] Tidak freeze panel bila fail besar.
  - [ ] Jika browser tak benarkan clipboard, sedia fallback download.
  - [ ] Uji paste dalam Photoshop Windows secara manual.
- **Related existing documentation:**
  - [docs/TASK_WORKSPACE_SIDE_PANEL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/TASK_WORKSPACE_SIDE_PANEL.md)

<a id="ic-016"></a>
### IC-016 — Print AWB & Reference Quick Actions

- **Area:** orders
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Dua butang print terus dari sidepanel ClickUp tanpa membuka preview halaman lain.
- **Scope:** Gunakan payload AWB dan reference order sedia ada, kekal tanpa duplikasi logic shipping.
- **Evidence/status note:** Dinyatakan dalam docs sidepanel; cetakan fizikal sebenar belum diuji dalam automasi.
- **Acceptance criteria:**
  - [ ] Butang Print AWB dan Print Reference dipaparkan pada task berkaitan.
  - [ ] Data print tepat dengan task/order semasa.
  - [ ] Gagal print dipaparkan dan tidak menukar status order.
  - [ ] Boleh digunakan desktop printer operator.
- **Related existing documentation:**
  - [docs/TASK_WORKSPACE_SIDE_PANEL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/TASK_WORKSPACE_SIDE_PANEL.md)

<a id="ic-017"></a>
### IC-017 — ClickUp Review & Status Dropdown

- **Area:** orders
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Pilihan Review customer, Change status dan Complete Task terus dari sidepanel.
- **Scope:** Status pilihan live ClickUp, simpan dan verify readback sebelum berjaya.
- **Evidence/status note:** Dokumen controlled QA ada; authenticated owner live validation belum selesai.
- **Acceptance criteria:**
  - [ ] Dropdown bukan pilihan hardcode yang boleh lapuk.
  - [ ] Status ClickUp dan review customer diasingkan.
  - [ ] Complete Task guna status yang betul.
  - [ ] Sekat mutasi salah task atau response tak pasti.
- **Related existing documentation:**
  - [docs/TASK_WORKSPACE_SIDE_PANEL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/TASK_WORKSPACE_SIDE_PANEL.md)

<a id="ic-018"></a>
### IC-018 — AI Action Dashboard

- **Area:** inbox
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Task kiri, chat asal di tengah, maklumat order dan aksi designer di kanan.
- **Scope:** Baris kategori produk + filter tindakan/due date, original Shopee/WhatsApp transcript, klik task tepat, output designer.
- **Evidence/status note:** Dokumen AI dashboard menyatakan frontend controlled verified dan backend production; owner QA hosted belum penuh.
- **Acceptance criteria:**
  - [ ] Satu row ClickUp Task ID/set tanpa collapse order multi-item.
  - [ ] Filter Semua/Edible/Topper/Acrylic/Wafer dan due/semakan.
  - [ ] Baca chat asal yang di-link dengan order sah.
  - [ ] Copy brief, paste image dan status update dengan rekod.
- **Related existing documentation:**
  - [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

<a id="ic-019"></a>
### IC-019 — Designer Paste Image to ClickUp

- **Area:** design
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Paste/upload hasil design di panel designer dan post terus sebagai attachment ClickUp.
- **Scope:** Upload attachment yang sebenar, tambah komen pautan, verify readback, elak menyimpan binari secara kekal.
- **Evidence/status note:** Dokumentasi Inbox ClickUp dan AI dashboard menunjukkan controlled verify; input Photoshop real belum disahkan.
- **Acceptance criteria:**
  - [ ] Paste Ctrl+V / drag-drop fail dengan preview.
  - [ ] Post ke task tepat dengan file asli.
  - [ ] Network timeout boleh disemak tanpa double-upload.
  - [ ] Tidak menyimpan fail binari kekal secara tak perlu.
- **Related existing documentation:**
  - [docs/INBOX_CLICKUP_DESIGN.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_CLICKUP_DESIGN.md)
  - [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

<a id="ic-020"></a>
### IC-020 — Unified Inbox Product & Order Cards

- **Area:** inbox
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Cari dan hantar Product Card serta Order Card Shopee dalam perbualan.
- **Scope:** Product catalog berimej + SKU dan order card dengan pautan/context yang betul.
- **Evidence/status note:** Dokumen integrasi Inbox Shopee cards wujud; user pernah melaporkan fokus input/imej hilang.
- **Acceptance criteria:**
  - [ ] Cari produk melalui nama/SKU dan hantar card provider.
  - [ ] Imej hilang ditandai dan boleh dibaiki dari katalog.
  - [ ] Order ID hanya dihantar bagi order chat berkaitan.
  - [ ] Input composer kekal fokus selepas hantar.
- **Related existing documentation:**
  - [docs/INBOX_SHOPEE_CARDS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_SHOPEE_CARDS.md)

<a id="ic-021"></a>
### IC-021 — Unified Inbox Order Lifecycle & Search

- **Area:** inbox
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Fokus To Ship, Shipping dan Delivered, conversation per order, urgent tag dan search global.
- **Scope:** Inbox hanya kerja relevan, close per order semasa shipped dan jangan reuse chat order lama.
- **Evidence/status note:** Dokumen lifecycle dan search sedia ada; user mahu terus betulkan filter dan state.
- **Acceptance criteria:**
  - [ ] Default To Ship dan count kategori tepat.
  - [ ] Order baharu membuka sesi kerja sendiri.
  - [ ] Auto remove urgent bagi shipped/cancelled.
  - [ ] Search order/phone/username pantas dan konsisten.
- **Related existing documentation:**
  - [docs/INBOX_CONVERSATION_LIFECYCLE.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_CONVERSATION_LIFECYCLE.md)
  - [docs/INBOX_SEARCH.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_SEARCH.md)

<a id="ic-022"></a>
### IC-022 — AI Inline Reply Suggestions

- **Area:** inbox
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Cadangan balasan Shopee/WhatsApp berasaskan FAQ, SOP dan data order tepat; staf semak sebelum hantar.
- **Scope:** Satu cadangan ringkas di atas composer, salin/insert untuk staf edit, guard kos panggilan AI.
- **Evidence/status note:** Dokumen Inbox suggestion controlled Chromium verified; hosted staffed flow belum disahkan.
- **Acceptance criteria:**
  - [ ] Cadangan tidak dihantar automatik.
  - [ ] Maklumat payment/order disahkan sebelum digunakan.
  - [ ] Retry dan budget guard mengelak API burst.
  - [ ] Perubahan konteks chat membatalkan cadangan usang.
- **Related existing documentation:**
  - [docs/INBOX_REPLY_SUGGESTIONS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_REPLY_SUGGESTIONS.md)

<a id="ic-023"></a>
### IC-023 — WhatsApp Username CRM & Identity

- **Area:** inbox
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** No (owner only)
- **Outcome:** Simpan WhatsApp username serta nombor telefon bila diketahui; padankan pelanggan/order dengan selamat.
- **Scope:** CRM support manual username, contact preview dan order mapping berasaskan bukti.
- **Evidence/status note:** Keperluan WhatsApp username dan CRM pernah dibincang, fungsi lengkap belum disahkan.
- **Acceptance criteria:**
  - [ ] Username boleh wujud tanpa nombor telefon.
  - [ ] Merge hanya dengan bukti nombor/identiti yang jelas.
  - [ ] Sejarah chat asal tidak bercampur antara pelanggan.
  - [ ] Data sensitif tidak terpapar dalam roadmap umum.

<a id="ic-024"></a>
### IC-024 — Draft Follow-Up & Shopee Auto Cancel

- **Area:** automation
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** No (owner only)
- **Outcome:** Pipeline Draft → F1/F2/F3 → Won/Cancelled, dengan pembatalan draf bila order Shopee sah wujud.
- **Scope:** Follow-up configurable, no spam, stop selepas cancellation/order berjaya.
- **Evidence/status note:** Workflow direka dan dokumen automation wujud; QA hosted end-to-end diperlukan.
- **Acceptance criteria:**
  - [ ] Owner boleh pause follow-up semasa peak.
  - [ ] Order Shopee sebenar menyebabkan draf matching dibatalkan dengan sebab audit.
  - [ ] Tiada WhatsApp auto hantar untuk draf void/cancel.
  - [ ] Dua order tidak duplicate draft/customer.
- **Related existing documentation:**
  - [docs/SHOPEE_DRAFT_AUTOCANCEL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_DRAFT_AUTOCANCEL.md)
  - [docs/DRAFT_LIST_ANALYTICS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/DRAFT_LIST_ANALYTICS.md)

<a id="ic-025"></a>
### IC-025 — QRPay Match: Tambah Tarikh

- **Area:** finance
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** No (owner only)
- **Outcome:** Paparkan tarikh dan masa transaksi semasa padankan draf bayaran QRPay.
- **Scope:** Tambahkan tarikh pada senarai candidate QRPay untuk semakan manual dengan amount/phone.
- **Evidence/status note:** Permintaan khusus 22 Okt 2026; tiada bukti patch live diterima.
- **Acceptance criteria:**
  - [ ] Tarikh transaksi dalam MYT dipaparkan untuk setiap calon.
  - [ ] Jumlah amaun dan status sudah/tiada match kekal jelas.
  - [ ] Tarikh bukan bukti pembayaran tunggal.
  - [ ] Tidak menukar logic pembayaran secara automatik.
- **Related existing documentation:**
  - [docs/QRPay_AI_DRAFT_REVIEW_V1.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/QRPay_AI_DRAFT_REVIEW_V1.md)

<a id="ic-026"></a>
### IC-026 — QRPay / Pickup Counter Rollout

- **Area:** finance
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** No (owner only)
- **Outcome:** Pembayaran penuh/separa, resit gabungan, undo/void, QRPay match/bypass dan pickup selesai.
- **Scope:** Operasi counter yang telus: matching, rekod pembayaran, staf permission dan notifikasi pengambilan.
- **Evidence/status note:** Banyak komponen telah dibina; pembuktian operator hosted semua kes masih diperlukan.
- **Acceptance criteria:**
  - [ ] Full/partial diasingkan dan jumlah baki tepat.
  - [ ] Undo/void membatalkan efek berkaitan, berjejak audit.
  - [ ] Pickup siap/terambil dengan permission staf.
  - [ ] Tracking dan notifikasi tidak berganda.
- **Related existing documentation:**
  - [docs/QRPay_AI_DRAFT_REVIEW_V1.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/QRPay_AI_DRAFT_REVIEW_V1.md)

<a id="ic-027"></a>
### IC-027 — Material Stock Reservation & Deduction

- **Area:** production
- **Priority:** P1
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Reserve bahan pada To Ship/paid, deduct selepas Shipped atau Ready for Pickup yang disahkan.
- **Scope:** Edible, wafer, glossy, mirror artpaper, acrylic mengikut warna dan double tape; reversal cancel sebelum consume.
- **Evidence/status note:** Dokumen STOCK_MANAGEMENT menyatakan backend production dan frontend controlled verified, owner opening counts perlu audit.
- **Acceptance criteria:**
  - [ ] A4/A5/A6 dikira pecahan penggunaan material yang betul.
  - [ ] Tidak deduct dua kali bagi order sama.
  - [ ] Cancel sebelum consume release reservation.
  - [ ] Acrylic colour dan rule tak lengkap perlu semakan, bukan teka.
- **Related existing documentation:**
  - [docs/STOCK_MANAGEMENT.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/STOCK_MANAGEMENT.md)

<a id="ic-028"></a>
### IC-028 — Acrylic Production View

- **Area:** production
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Senaraikan task Acrylic/Artpaper mengikut warna, saiz, status dan design asal untuk production.
- **Scope:** Filter warna + status Printing/Review, original image dan due date task.
- **Evidence/status note:** Dokumen ACRYLIC_PRODUCTION menyatakan production dan controlled QA verified; semakan owner hosted tidak penuh.
- **Acceptance criteria:**
  - [ ] Material Acrylic vs Artpaper tidak bercampur.
  - [ ] Filter hanya job yang sah.
  - [ ] Original image task boleh dilihat.
  - [ ] Task tanpa saiz/warna jelas ditanda perlu semak.
- **Related existing documentation:**
  - [docs/ACRYLIC_PRODUCTION.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ACRYLIC_PRODUCTION.md)

<a id="ic-029"></a>
### IC-029 — SKU Template Renderer Automation

- **Area:** design
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Render design topper/edible automatik daripada SKU, nama, posisi, curve text dan template asal.
- **Scope:** Endpoint output dari template 1 field dahulu, kemudian multiple fields, stroke, per-font colours dan QA.
- **Evidence/status note:** Render-test pernah berfungsi; pipeline output berskala belum disahkan.
- **Acceptance criteria:**
  - [ ] Template disimpan melalui Admin, bukan hardcode developer.
  - [ ] Render 1 field berdasarkan SKU deterministik.
  - [ ] Output JPG/PNG resolusi sesuai dan boleh attach task.
  - [ ] Reviewer boleh bezakan output auto/AI assisted/manual.

<a id="ic-030"></a>
### IC-030 — AI Vision Quality Control

- **Area:** design
- **Priority:** P2
- **Baseline status:** idea
- **Public roadmap:** Yes
- **Outcome:** Semakan visual artwork kepada SOP margin, ruang potong, silhouette dan tiada overlap.
- **Scope:** Vision QC cadangkan isu, bukan auto-lulus semua imej; gunakan rule A4 dan acrylic laser cut.
- **Evidence/status note:** Idea AI QC Vision yang belum diimplementasi.
- **Acceptance criteria:**
  - [ ] Semak margin, gap dan overlap A4 topper.
  - [ ] Semak sambungan huruf untuk acrylic laser cut.
  - [ ] Tanda confidence dan rujuk manusia pada kes samar.
  - [ ] Simpan bukti QC per design tanpa imej berganda tak perlu.

<a id="ic-031"></a>
### IC-031 — Smart Photo Collage Engine

- **Area:** design
- **Priority:** P2
- **Baseline status:** idea
- **Public roadmap:** Yes
- **Outcome:** Susun 30–50 foto pelanggan secara automatik sambil mengekalkan foto dan wajah asal.
- **Scope:** AI hanya merancang layout/crop; Sharp compositor dan editor manual override; output 1:1.
- **Evidence/status note:** Perancangan terdahulu; bukan modul live.
- **Acceptance criteria:**
  - [ ] Gambar/wajah asli tidak dijana semula.
  - [ ] Layout grid/creative/circle/shape.
  - [ ] Face-aware crop dan manual correction.
  - [ ] Export resolusi print dengan margin.

<a id="ic-032"></a>
### IC-032 — Remove Background Internal Tool

- **Area:** design
- **Priority:** P3
- **Baseline status:** idea
- **Public roadmap:** Yes
- **Outcome:** Buang latar gambar dalam iCetak tanpa ubah bentuk objek/gambar asal.
- **Scope:** Cari pendekatan model segmentation, preview, alpha edge dan penggunaan secara manual.
- **Evidence/status note:** Idea dalaman, belum disahkan dibina.
- **Acceptance criteria:**
  - [ ] Geometri imej kekal.
  - [ ] PNG transparent bersih.
  - [ ] Provider/model boleh ditukar.
  - [ ] Uji pada foto pelanggan dan printed topper yang kompleks.

<a id="ic-033"></a>
### IC-033 — Edible Sheet Quote Calculator

- **Area:** orders
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Kira kapasiti helai A4/A5/A6, kuantiti potong dan harga sebut harga pelanggan.
- **Scope:** Kalkulator print-only vs print-&-cut berdasar saiz bentuk sebenar dan rules tempahan penuh.
- **Evidence/status note:** Jadual kapasiti dan harga telah ditentukan, sistem kalkulator belum disahkan.
- **Acceptance criteria:**
  - [ ] Kapasiti 2.5 inci: print only 12/A4, print&cut 11/A4.
  - [ ] 5 cm: 18/A4 print only, 15/A4 print&cut.
  - [ ] Cutting RM5/A4 hanya edible, bukan glossy.
  - [ ] Pelanggan dapat mesej quotation siap pos.

<a id="ic-034"></a>
### IC-034 — Branded Short URLs

- **Area:** infrastructure
- **Priority:** P3
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Short link rasmi seperti decocake.my/edible, /wafer, /acrylic dan /topper.
- **Scope:** Route pendek boleh diedit, kira klik jika perlu, redirect kekal dan anti-open redirect.
- **Evidence/status note:** Cadangan short URL dalam perbualan, belum disahkan live.
- **Acceptance criteria:**
  - [ ] Slug mudah dari domain sendiri.
  - [ ] Hanya owner ubah destination.
  - [ ] Redirect tidak membawa kepada laman berbahaya tanpa semakan.
  - [ ] Boleh paut ke produk atau katalog khusus.

<a id="ic-035"></a>
### IC-035 — Order Detail Completeness Scanner

- **Area:** automation
- **Priority:** P1
- **Baseline status:** planned
- **Public roadmap:** No (owner only)
- **Outcome:** Kira LENGKAP/TAK LENGKAP berdasarkan job dan chat Shopee/WhatsApp sebelum kerja design.
- **Scope:** Morning summary dan recheck selepas pelanggan edit note/detail order.
- **Evidence/status note:** Perancangan AI Action Dashboard/morning check; status end-to-end belum disahkan.
- **Acceptance criteria:**
  - [ ] Topper memerlukan wording, Edible/Wafer memerlukan image atau wording.
  - [ ] Acrylic menerima wording, sample atau image sahaja; jika kosong semak admin.
  - [ ] Deteksi perubahan customer note/chat dan refresh status.
  - [ ] Designer boleh lihat sumber bukti dan alasan incomplete.
- **Related existing documentation:**
  - [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

<a id="ic-036"></a>
### IC-036 — Inbox 30-Min Missing Detail Follow-Up

- **Area:** automation
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** No (owner only)
- **Outcome:** Jika order masuk tanpa detail, queue follow-up selepas 30 minit dan fallback apabila due hampir tamat.
- **Scope:** Perlu semak reply manusia, stop bila detail diterima, auto default tanpa nama hanya selepas guard due.
- **Evidence/status note:** Workflow pernah dirancang dan dibina sebahagiannya; audit provider send diperlukan.
- **Acceptance criteria:**
  - [ ] Timer 30 minit bermula pada order event yang sah.
  - [ ] Balasan sebelum hantar membatalkan follow-up.
  - [ ] Urgent/due windows dikendalikan.
  - [ ] Tiada duplicate send walau webhook masuk dua kali.
- **Related existing documentation:**
  - [docs/INBOX_ACTIVE_ORDERS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/INBOX_ACTIVE_ORDERS.md)

<a id="ic-037"></a>
### IC-037 — ClickUp AI Design Routing

- **Area:** design
- **Priority:** P2
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Order/WhatsApp → AUTO / AI-assisted / MANUAL → QA → Approval → Production.
- **Scope:** Router memilih aliran render SKU atau designer berdasarkan kejelasan brief dan sumber assets.
- **Evidence/status note:** Workflow dirancang, belum diuji automation end-to-end.
- **Acceptance criteria:**
  - [ ] Pembahagian auto/AI/manual jelas.
  - [ ] Fail gambar customer dilindungi.
  - [ ] Semakan manusia pada output tidak yakin.
  - [ ] Paut ke ClickUp task untuk sign-off.
- **Related existing documentation:**
  - [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

<a id="ic-038"></a>
### IC-038 — Shopee Finance Order Contribution KPI

- **Area:** finance
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** No (owner only)
- **Outcome:** Kira nett order berdasarkan fee, refund, kos bahan dan jualan; paid-only untuk dashboard.
- **Scope:** Dashboard Finance seller fee breakdown lengkap dan Shopee vs WhatsApp/Decocake split.
- **Evidence/status note:** Dokumen Finance Order Detail menyatakan backend dan controlled UI verified; owner hosted masih diperlukan.
- **Acceptance criteria:**
  - [ ] Fee provider dan shipping tidak double count.
  - [ ] Paid/released/missing dipisah jelas.
  - [ ] Profit contribution bukan P&L overhead.
  - [ ] Penapis paid-only, return/refund dan date.
- **Related existing documentation:**
  - [docs/ORDER_FINANCE_DETAIL.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_FINANCE_DETAIL.md)

<a id="ic-039"></a>
### IC-039 — Roadmap Feedback, Voting & Releases

- **Area:** infrastructure
- **Priority:** P3
- **Baseline status:** planned
- **Public roadmap:** Yes
- **Outcome:** Fasa kedua roadmap SaaS: user feedback, vote, release note dan status automatik apabila PR release disahkan.
- **Scope:** Maklum balas tanpa expose detail pelanggan; optional votes, release notes dan pautan deployment proof.
- **Evidence/status note:** Fasa 2 konsep SaaS seperti rujukan ClickUp, belum dibina.
- **Acceptance criteria:**
  - [ ] Maklum balas dikawal spam dan moderation.
  - [ ] Perubahan status tidak auto-complete hanya kerana PR merged.
  - [ ] Changelog boleh dipadankan dengan commit/production release.
  - [ ] Public boleh lihat cuma feature yang approved.

<a id="ic-040"></a>
### IC-040 — WhatsApp/Shopee Draft-to-Order Integration

- **Area:** orders
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** No (owner only)
- **Outcome:** Draft approval → order sebenar, payment link, public order status dan courier/pickup actions.
- **Scope:** Satu pipeline draft → order dengan partial/full payment, reminder dan ClickUp task link.
- **Evidence/status note:** Sistem draft telah banyak iterasi, perlu audit hosted flow mengikut perubahan terkini.
- **Acceptance criteria:**
  - [ ] Draft approved hanya mencipta satu order.
  - [ ] WhatsApp tidak auto dihantar selepas cancel/void.
  - [ ] Payment page mengemas kini paid state dengan rekod.
  - [ ] Multi item set1..setN kekal berasingan.
- **Related existing documentation:**
  - [docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md)
  - [docs/QUICK_ORDER_DRAFT_CONTRACT_V1.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/QUICK_ORDER_DRAFT_CONTRACT_V1.md)

<a id="ic-041"></a>
### IC-041 — Roadmap Documentation Reference Links

- **Area:** infrastructure
- **Priority:** P2
- **Baseline status:** testing
- **Public roadmap:** Yes
- **Outcome:** Setiap roadmap item boleh dipaut kepada spesifikasi Markdown di GitHub dan rujukan release.
- **Scope:** Field reference_url dalam DB dan butang Buka dokumen rujukan dalam panel detail.
- **Evidence/status note:** Migration dan perubahan UI baru dimasukkan; perlukan pengesahan Cloudflare selepas release.
- **Acceptance criteria:**
  - [ ] Setiap item boleh simpan URL HTTPS rujukan.
  - [ ] Klik item menampilkan link Markdown pada panel detail.
  - [ ] Link selamat open new tab dengan rel noopener.
  - [ ] Rujukan sentiasa selaras dengan feature ID/owner status.


## Additions 25 October 2026 — Business reporting & pricing analysis

The 25 October shipping/finance discussion has been archived in the [full 727-line Markdown document](./ICETAK_SHIPPING_FINANCE_DAILY_REPORT_2026-10-25.md). These are **owner-only planned items**; they are not verified production features. Original business figures are dated snapshots.

<a id="ic-072"></a>
### IC-072 — Daily Business Report + WhatsApp Admin
- **Area:** finance / automation; **Priority:** P1; **Status:** in progress (backend verified; template approval / owner UI test pending); **Visibility:** Owner only.
- **Outcome:** Daily 08:30 MYT automated WhatsApp report covering previous-day Shopee, WhatsApp, Decocake website and walk-in/pickup sales; order counts, platform fees, materials, packing, courier, contribution, MTD comparisons and end-of-month forecast.
- **Backend contract:** Supabase pg_cron → Finance RPC + Edge Function → daily report snapshot → WasapFlow admin number. Reuse QRPay Daily Summary delivery/retry foundations; no ChatGPT or Activepieces at runtime.
- **Acceptance criteria:**
  - [x] Correct Malaysia date boundaries and order/settlement deduplication.
  - [x] Separate revenue, payout, contribution and verified net profit; mark estimated costs explicitly.
  - [x] Show source attribution and reporting coverage or missing-data warning.
  - [x] Persist one run per date/type/recipient, message snapshot, provider message ID and delivery status; retry without double send.
  - [ ] Admin ON/OFF, recipient, preview, test send and report history.
  - [ ] Comply with WhatsApp session / approved template requirements and verify actual delivery.
  - [ ] Hosted owner test before Completed.

- **Implementation:** [Daily report operations](../DAILY_BUSINESS_REPORT.md). First real provider acceptance verified on 25 Oct MYT; delivery/read and closed-window template approval remain pending.

<a id="ic-073"></a>
### IC-073 — Channel Profitability, Shipping P&L & Pricing Strategy
- **Area:** finance; **Priority:** P1; **Status:** planned; **Visibility:** Owner only.
- **Outcome:** Measure margin per SKU, order and channel across Shopee, website, WhatsApp and walk-in, including real marketplace fee, subsidies, direct payment charges, material cost, packing, courier, ads and refunds.
- **Business decisions:** Same product price on all channels; retain Decocake SPX RM4.50 while verified ParcelDaily cost is RM4.50; free shipping is an intentional acquisition cost, evaluated against Shopee fees and repeat sales rather than automatically labelled a loss.
- **Acceptance criteria:**
  - [ ] Separate postage customer charge, courier cost and seller subsidy.
  - [ ] Separate platform fee and seller-borne shipping; no double-counting settlement elements.
  - [ ] Differentiate contribution from audited profit after wages, overhead and ads.
  - [ ] Monthly like-for-like date comparisons and evidence-based forecasts.
  - [ ] No automatic price or shipping changes without owner approval.

<a id="ic-074"></a>
### IC-074 — Source Attribution & Cost Reconciliation
- **Area:** finance / orders; **Priority:** P1; **Status:** planned; **Visibility:** Owner only.
- **Outcome:** Record actual intake channel independently of workflow source and fulfillment method. Current draft_engine orders mix WhatsApp, website checkout and counter, so historical channel splits are provisional.
- **Acceptance criteria:**
  - [ ] Persist channel, intake source and courier/pickup fulfillment as independent fields.
  - [ ] Source identification based on traceable evidence; unknown sources remain Unknown.
  - [ ] Reconcile Shopee financials, SKU material costs, ParcelDaily charges, customer shipping, cash counter and refund records.
  - [ ] Expose estimated vs actual cost flags, coverage %, timestamp and reconciliation exceptions.
  - [ ] Backfill safe historic rows without fabricating channel or profit.

## Delivery and change control
1. Each feature requires an owner acceptance check and proof before moving to Completed; controlled tests alone can remain Testing.
2. Never perform automatic writes to Shopee products/Ads, ClickUp statuses, QRPay funds, WhatsApp messages, or stock without matching policy, idempotency, access control and operator confirmation.
3. Roadmap items are distinct from customer orders and should not change canonical fulfillment status by themselves.
4. Stage score is not a timestamp or percentage of work hours completed. Leave target dates blank until a real delivery date is committed.
5. Update `icetak_roadmap_updates` for significant milestones and link released changes to repository docs/commit.

## Next order of work (recommended)
1. Stabilise ClickUp Sidepanel original image and staff clipboard/printing QA.
2. Deliver per-product Keyword Intelligence (read-only) and SEO audit for an initial small batch.
3. Finish QRPay timestamp and owner validations on existing stock/inbox/profit modules.
4. Introduce Seasonal Radar with snapshot history, then Ads Profit Analyzer.
5. Only then activate POD auto stock refill with explicit operator-defined caps.

Last coordinated baseline: 2026-10-23.