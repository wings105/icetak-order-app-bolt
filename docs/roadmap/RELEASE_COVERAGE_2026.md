# iCetak Roadmap — Changelog coverage & additional project backlog

Baseline review: 23 October 2026 MYT. Complements [IC-001 to IC-041](./ROADMAP_MASTER_PLAN_2026.md).
These items were found by reconciling the current production `CHANGELOG.md`, existing documentation and historical iCetak plans. A changelog entry is release evidence, not automatic user acceptance or proof of every operational flow.

## Added feature index
| ID | Feature | Category | Status | Source document |
|---|---|---|---|---|
| [IC-042](#ic-042) | Shared Storefront Catalogue & Checkout | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/catalog/STOREFRONT_ROLLOUT.md) |
| [IC-043](#ic-043) | Cake Mockup 3D & Edible Sizing | design | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CAKE_MOCKUP.md) |
| [IC-044](#ic-044) | Business Command Center | finance | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CONTRIBUTION_TARGETS.md) |
| [IC-045](#ic-045) | Customer Focus & Daily Order Queue | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CUSTOMER_FOCUS.md) |
| [IC-046](#ic-046) | Reply Knowledge & Safe Learning | inbox | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/REPLY_KNOWLEDGE.md) |
| [IC-047](#ic-047) | Shopee Webhook Monitor & Recovery | shopee | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md) |
| [IC-048](#ic-048) | Shopee SG Connection & Release Wallet | shopee | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_SG_TOKEN_PUSH.md) |
| [IC-049](#ic-049) | Shopee Direct Chat, Read & Reply State | inbox | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_CHAT_DIRECT_SETUP.md) |
| [IC-050](#ic-050) | Shopee Sticker & Image Messages | inbox | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_IMAGE_SEND.md) |
| [IC-051](#ic-051) | WhatsApp API Outbound Inbox Logging | inbox | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/WHATSAPP_API_INBOX_SYNC.md) |
| [IC-052](#ic-052) | 24-Hour WhatsApp Window Safety | automation | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/DIRECT_CHECKOUT_WHATSAPP.md) |
| [IC-053](#ic-053) | Shopee Missing-Order Reconciliation Checker | automation | planned | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md) |
| [IC-054](#ic-054) | ClickUp Outbox Custom Fields & Job Mapping | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/taskmagic-production-price-set.md) |
| [IC-055](#ic-055) | ClickUp AWB Preview & Batch Print | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AWB_PREVIEW.md) |
| [IC-056](#ic-056) | Order Detail Collector & Worker | automation | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_DETAIL_AUTOMATION.md) |
| [IC-057](#ic-057) | Customer CRM Identity & Address Merge | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_DETAIL_COLLECTION.md) |
| [IC-058](#ic-058) | Customer Tracking & Shipping Notifications | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHIPPING_AGENT_GUIDE.md) |
| [IC-059](#ic-059) | Sales SKU Analytics & Acrylic Colour | finance | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SALES_SKU.md) |
| [IC-060](#ic-060) | Contribution Targets & Monthly Overhead | finance | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CONTRIBUTION_TARGETS.md) |
| [IC-061](#ic-061) | Shopee Provider Order Status Reconciliation | shopee | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/MARKETPLACE_STATUS_RECONCILIATION.md) |
| [IC-062](#ic-062) | Admin V2 Permissions & Production Safety | infrastructure | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ADMIN_V2_SOURCE_OF_TRUTH.md) |
| [IC-063](#ic-063) | Shopee Seller Operations Monitor | shopee | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md) |
| [IC-064](#ic-064) | QRPay Exception & Unmatched Review | finance | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/QRPay_AI_DRAFT_REVIEW_V1.md) |
| [IC-065](#ic-065) | AI Design Template Editor & Native Render Export | design | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/RENDER_TEMPLATES_V2.md) |
| [IC-066](#ic-066) | Courier AWB / SPX Link Recovery | automation | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AWB_PREVIEW.md) |
| [IC-067](#ic-067) | ClickUp AI Agent / Super Agents Evaluation | automation | idea | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md) |
| [IC-068](#ic-068) | AI Dashboard Customer Case Briefs | inbox | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md) |
| [IC-069](#ic-069) | Pickup Notification and Ready Collection | orders | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/STOCK_MANAGEMENT.md) |
| [IC-070](#ic-070) | AI Design Feedback & Customer Approval | design | testing | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/DRAFT_AI_FEEDBACK_V14.md) |
| [IC-071](#ic-071) | Finance Webhook Reliability / Activepieces | finance | planned | [reference](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/FINANCE_WEBHOOK_SETUP.md) |

## Contracts

<a id="ic-042"></a>
### IC-042 — Shared Storefront Catalogue & Checkout

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Yes

**Summary:** Katalog DecoCake dengan browse, search, kategori, imej dan checkout harga server-authoritative.

**Current facts and scope:**
- 1,738 design boleh dilayari dan 266 produk dalam review pada release 17 Okt.
- Sokong variation, custom wording, ukuran dan image original mengikut produk.

**Definition of done (pending owner verification):**
- [ ] Semak checkout desktop dan telefon dengan item/variasi tepat.
- [ ] Pastikan hanya produk diterbitkan boleh dibeli.
- [ ] Audit order nyata dan pembayaran selepas rollout.

**Original subsystem reference:** [docs/catalog/STOREFRONT_ROLLOUT.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/catalog/STOREFRONT_ROLLOUT.md)

---

<a id="ic-043"></a>
### IC-043 — Cake Mockup 3D & Edible Sizing

**Category:** design · **Priority:** P2 · **Baseline stage:** testing · **Public:** Yes

**Summary:** Visualisasi 3D kek bertingkat serta edible top/side dan harga mengikut shape/size.

**Current facts and scope:**
- Mockup round/rect, 1–4 tiers; output PNG preview.
- Preset edible bentuk/besar/kecil berdasarkan senarai 34 pilihan.

**Definition of done (pending owner verification):**
- [ ] Sahkan ratio mm/inch dan kuantiti untuk production.
- [ ] Semak gambar download pada kes kompleks.
- [ ] Bezakan mockup daripada gambar produk sebenar.

**Original subsystem reference:** [docs/CAKE_MOCKUP.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CAKE_MOCKUP.md)

---

<a id="ic-044"></a>
### IC-044 — Business Command Center

**Category:** finance · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Satu dashboard KPI seluruh sistem untuk sales, order, operasi, hutang dan keputusan harian.

**Current facts and scope:**
- Snapshot dua Supabase project wujud; UI pernah direkod attempted.
- Satukan KPI paid-only, margin, due/urgent dan tindakan owner.

**Definition of done (pending owner verification):**
- [ ] Sahkan semua sumber ikut owner contract.
- [ ] Audit permission untuk data kewangan.
- [ ] Semak real hosted owner UI sebelum Completed.

**Original subsystem reference:** [docs/CONTRIBUTION_TARGETS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CONTRIBUTION_TARGETS.md)

---

<a id="ic-045"></a>
### IC-045 — Customer Focus & Daily Order Queue

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Senarai pesanan/pelanggan yang memerlukan tindakan hari ini, termasuk marketplace dan Decocake.

**Current facts and scope:**
- Daily scope, contact shortcuts, manual/bulk actions sudah diuji.
- Asingkan status production ClickUp daripada status Shopee shipping.

**Definition of done (pending owner verification):**
- [ ] Default order relevan hari ini dan upcoming due.
- [ ] Semua order aktif mempunyai sumber/urgency jelas.
- [ ] Bulk action mesti ada guard dan audit.

**Original subsystem reference:** [docs/CUSTOMER_FOCUS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CUSTOMER_FOCUS.md)

---

<a id="ic-046"></a>
### IC-046 — Reply Knowledge & Safe Learning

**Category:** inbox · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** FAQ berstatus draft/published dan AI belajar gaya balas daripada jawapan manusia yang disahkan.

**Current facts and scope:**
- Knowledge tab pernah menyimpan 19 FAQ published, 61 draf.
- Hanya fakta published dipakai untuk cadangan chat.

**Definition of done (pending owner verification):**
- [ ] Semak artikel bercanggah sebelum publish.
- [ ] Jangan belajar daripada AI-generated message sendiri.
- [ ] Sedia rollback/update versi FAQ.

**Original subsystem reference:** [docs/REPLY_KNOWLEDGE.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/REPLY_KNOWLEDGE.md)

---

<a id="ic-047"></a>
### IC-047 — Shopee Webhook Monitor & Recovery

**Category:** shopee · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Log inbound webhook, event dedupe, recovery queue dan audit alert bagi order/chat/refund.

**Current facts and scope:**
- Pemulihan 79 failed/chat events direkod dalam changelog 12 Okt.
- Alert notification, price/promotion/penalty, ship-by dan refund tersedia.

**Definition of done (pending owner verification):**
- [ ] Alert operator jika webhook gagal/tidak diproses.
- [ ] Retry bermasa tanpa duplicate order/customer send.
- [ ] Banding provider order dan snapshot lokal.

**Original subsystem reference:** [docs/SHOPEE_WEBHOOK_OPERATIONS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md)

---

<a id="ic-048"></a>
### IC-048 — Shopee SG Connection & Release Wallet

**Category:** shopee · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Token dan order finance Shopee Singapura berasingan daripada Malaysia, termasuk SGD release/refund.

**Current facts and scope:**
- Shop-scoped token/cursor/polling di backend pernah diuji.
- SG token push berikutnya perlu bukti end-to-end daripada pengeluar token.

**Definition of done (pending owner verification):**
- [ ] Kekalkan pemisahan shop/currency.
- [ ] Jangan import order personal ke ledger iCetak tanpa pilihan jelas.
- [ ] Sahkan cron producer dan reconciliation release.

**Original subsystem reference:** [docs/SHOPEE_SG_TOKEN_PUSH.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_SG_TOKEN_PUSH.md)

---

<a id="ic-049"></a>
### IC-049 — Shopee Direct Chat, Read & Reply State

**Category:** inbox · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Send/reply Shopee Chat terus, mark read dan clear Perlu Balas hanya selepas proof provider.

**Current facts and scope:**
- Direct Chat API mendapat permission khusus dan diuji.
- Guard concurrent inbound, unknown send dan terminal urgent telah dibina.

**Definition of done (pending owner verification):**
- [ ] Uji read receipts di Shopee seller web sebenar.
- [ ] Balasan baru tidak boleh dibuang oleh sender lama.
- [ ] Session selesai ditutup per order tanpa hilang chat history.

**Original subsystem reference:** [docs/SHOPEE_CHAT_DIRECT_SETUP.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_CHAT_DIRECT_SETUP.md)

---

<a id="ic-050"></a>
### IC-050 — Shopee Sticker & Image Messages

**Category:** inbox · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Hantar dan terima sticker rasmi serta imej Shopee dalam Unified Inbox.

**Current facts and scope:**
- 30 sticker orangutan tersedia dalam UI terkawal.
- Image paste/send dan received sticker CDN pernah diuji.

**Definition of done (pending owner verification):**
- [ ] Uji hosted staff send pada akaun sebenar.
- [ ] Media gagal mesti fallback dengan jelas.
- [ ] Elak media duplicate apabila resend timeout.

**Original subsystem reference:** [docs/SHOPEE_IMAGE_SEND.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_IMAGE_SEND.md)

---

<a id="ic-051"></a>
### IC-051 — WhatsApp API Outbound Inbox Logging

**Category:** inbox · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Semua WhatsApp API keluar direkod semula ke Inbox walaupun webhook echo tidak sampai.

**Current facts and scope:**
- Pernah memulihkan tiga notification record secara sekali sahaja.
- Idempotency provider ID + phone/session dipelihara.

**Definition of done (pending owner verification):**
- [ ] Test provider sends dari semua laluan sebenar.
- [ ] Jangan resend customer message kerana log gagal.
- [ ] Pastikan 24h window dan opt-out kekal.

**Original subsystem reference:** [docs/WHATSAPP_API_INBOX_SYNC.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/WHATSAPP_API_INBOX_SYNC.md)

---

<a id="ic-052"></a>
### IC-052 — 24-Hour WhatsApp Window Safety

**Category:** automation · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Kawal outbound WhatsApp berdasarkan window 24 jam yang benar, message order dan opt-out.

**Current facts and scope:**
- Delayed WasapFlow events tidak patut mengundur window.
- Queue customer consent dan retries telah dibangunkan.

**Definition of done (pending owner verification):**
- [ ] Periksa last inbound timestamp authoritative.
- [ ] Manual/template outside window mengikut polisi.
- [ ] Semak CI keselamatan khusus yang pernah gagal sebelum sign-off.

**Original subsystem reference:** [docs/DIRECT_CHECKOUT_WHATSAPP.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/DIRECT_CHECKOUT_WHATSAPP.md)

---

<a id="ic-053"></a>
### IC-053 — Shopee Missing-Order Reconciliation Checker

**Category:** automation · **Priority:** P1 · **Baseline stage:** planned · **Public:** Owner only

**Summary:** Semak To Ship Shopee terhadap order/ClickUp, pulih task hilang selepas window delay.

**Current facts and scope:**
- Webhooks utama dan Shopee backup sudah ada dalam perancangan.
- Checker ketiga setiap 15–30 minit masih memerlukan pelaksanaan/disahkan.

**Definition of done (pending owner verification):**
- [ ] Banding semua Ready-to-Ship dan Processed.
- [ ] Tunggu grace period sebelum create fallback.
- [ ] Semua create idempotent berdasarkan Order ID + item identity.

**Original subsystem reference:** [docs/SHOPEE_WEBHOOK_OPERATIONS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md)

---

<a id="ic-054"></a>
### IC-054 — ClickUp Outbox Custom Fields & Job Mapping

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Map CF job, RM, multiple set, due date, alamat dan courier semasa create/update ClickUp task.

**Current facts and scope:**
- Job label dan set conditional sudah melalui ujian gateway.
- Downstream TaskMagic perlu semak live field write.

**Definition of done (pending owner verification):**
- [ ] Typed CF options diambil daripada definisi ClickUp.
- [ ] Jangan duplicate task apabila backup webhook masuk.
- [ ] Tepat untuk banyak item/order dan courier.

**Original subsystem reference:** [docs/taskmagic-production-price-set.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/taskmagic-production-price-set.md)

---

<a id="ic-055"></a>
### IC-055 — ClickUp AWB Preview & Batch Print

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Yes

**Summary:** Halaman preview AWB dan reference A4/A6 dengan gambar task, nama dan print PDF.

**Current facts and scope:**
- AWB preview public mengelompokkan task 4×4 per A4.
- Print AWB/Reference digunakan juga di sidepanel.

**Definition of done (pending owner verification):**
- [ ] Ambil semua image komen/link task relevan.
- [ ] Cetak pada printer operator tanpa tab tersilap.
- [ ] Pastikan PDF sama dengan order yang dipilih.

**Original subsystem reference:** [docs/AWB_PREVIEW.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AWB_PREVIEW.md)

---

<a id="ic-056"></a>
### IC-056 — Order Detail Collector & Worker

**Category:** automation · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Kumpul perubahan wording, media dan item notes daripada chat/order ke brief ClickUp.

**Current facts and scope:**
- Worker menyimpan order awal dan reread 30 minit.
- Beza order session dan multi-item berlabel.

**Definition of done (pending owner verification):**
- [ ] Tunjuk LENGKAP/TAK LENGKAP beserta alasan.
- [ ] Tiada chat lama masuk order baharu.
- [ ] Reviewer boleh approve/edit fakta.

**Original subsystem reference:** [docs/ORDER_DETAIL_AUTOMATION.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_DETAIL_AUTOMATION.md)

---

<a id="ic-057"></a>
### IC-057 — Customer CRM Identity & Address Merge

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Gabung customer Shopee, WhatsApp, Google Contacts dan order sendiri mengikut bukti identiti.

**Current facts and scope:**
- CRM merges daripada trusted phone pernah digunakan.
- Username tanpa nombor tidak semestinya cukup untuk auto-merge.

**Definition of done (pending owner verification):**
- [ ] Telefon normalized dan alamat multiple disimpan.
- [ ] Ambiguity masuk manual match queue.
- [ ] Tidak dedahkan PII dalam roadmap umum.

**Original subsystem reference:** [docs/ORDER_DETAIL_COLLECTION.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ORDER_DETAIL_COLLECTION.md)

---

<a id="ic-058"></a>
### IC-058 — Customer Tracking & Shipping Notifications

**Category:** orders · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Tracking status courier, SPX suffix, shipment progress dan pemberitahuan selepas dispatch.

**Current facts and scope:**
- SPX ParcelDaily suffix A sudah disokong.
- Pickup + shipped status dipaparkan berasingan.

**Definition of done (pending owner verification):**
- [ ] Kurir SPX/JNT/Ninja dan lain mempunyai mapping stabil.
- [ ] No duplicate notification selepas retries.
- [ ] Customer tracking hanya untuk order sah.

**Original subsystem reference:** [docs/SHIPPING_AGENT_GUIDE.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHIPPING_AGENT_GUIDE.md)

---

<a id="ic-059"></a>
### IC-059 — Sales SKU Analytics & Acrylic Colour

**Category:** finance · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Ranking SKU, jualan/untung mengikut kategori, variasi warna acrylic dan export CSV.

**Current facts and scope:**
- Kategori dan breakdown warna telah melalui controlled QA.
- SKU mapping daripada catalogue dan Finance digunakan.

**Definition of done (pending owner verification):**
- [ ] Filter period/kategori/warna reconcile dengan jumlah.
- [ ] SKU tanpa kategori masuk Lain-lain.
- [ ] CSV mesti ikut data yang ditapis.

**Original subsystem reference:** [docs/SALES_SKU.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SALES_SKU.md)

---

<a id="ic-060"></a>
### IC-060 — Contribution Targets & Monthly Overhead

**Category:** finance · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Banding gross contribution, target overhead dan untung real kepada sasaran perniagaan.

**Current facts and scope:**
- Target contribution pernah ada UI dan backend.
- Margin per kategori berubah mengikut costing dan Shopee fee.

**Definition of done (pending owner verification):**
- [ ] Paid/released vs estimated dipisah.
- [ ] Target overhead owner configurable.
- [ ] Jangan panggil gross contribution keuntungan akhir.

**Original subsystem reference:** [docs/CONTRIBUTION_TARGETS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/CONTRIBUTION_TARGETS.md)

---

<a id="ic-061"></a>
### IC-061 — Shopee Provider Order Status Reconciliation

**Category:** shopee · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Pemetaan CANCELLED/processed/ready-to-ship, refund dan tie-breaking event provider.

**Current facts and scope:**
- Cancelled wins same-time tie telah diuji.
- Projection ke Inbox diselaraskan dengan status terminal.

**Definition of done (pending owner verification):**
- [ ] To Ship termasuk PROCESSED apabila sah.
- [ ] Terminal status tak diubah webhook lama.
- [ ] Provider evidence audit tersedia.

**Original subsystem reference:** [docs/MARKETPLACE_STATUS_RECONCILIATION.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/MARKETPLACE_STATUS_RECONCILIATION.md)

---

<a id="ic-062"></a>
### IC-062 — Admin V2 Permissions & Production Safety

**Category:** infrastructure · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Akses owner/staff per modul, JWT/RLS, guards mutasi dan audit operator.

**Current facts and scope:**
- Admin V2 menggunakan secured backend dan RLS.
- Readonly viewer tidak boleh buat mutasi ClickUp/payment.

**Definition of done (pending owner verification):**
- [ ] Sahkan semua peranan staff dan minimum access.
- [ ] Error tidak dedah API token/service key.
- [ ] Semua perubahan sensitif ada receipt/audit.

**Original subsystem reference:** [docs/ADMIN_V2_SOURCE_OF_TRUTH.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/ADMIN_V2_SOURCE_OF_TRUTH.md)

---

<a id="ic-063"></a>
### IC-063 — Shopee Seller Operations Monitor

**Category:** shopee · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Dashboard operasi Shopee untuk listing, shipment, returns, API events dan warnings.

**Current facts and scope:**
- Admin V2 Shopee Monitor & Settings muncul dalam changelog.
- Status account/notif dan provider edge cases dibaca tanpa customer sends.

**Definition of done (pending owner verification):**
- [ ] Paparkan event backlog dan failed recovery.
- [ ] Warning jelas berasaskan real API.
- [ ] Tiada perubahan seller listing tanpa approval.

**Original subsystem reference:** [docs/SHOPEE_WEBHOOK_OPERATIONS.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/SHOPEE_WEBHOOK_OPERATIONS.md)

---

<a id="ic-064"></a>
### IC-064 — QRPay Exception & Unmatched Review

**Category:** finance · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Payment unmatched, manual reconcile, partial payment, audit undo/void dan mismatch fail-closed.

**Current facts and scope:**
- QRPay unmatched fail-closed flow direkod.
- Date matching UI di changelog 22 Okt telah verified secara controlled.

**Definition of done (pending owner verification):**
- [ ] Tidak create customer/order daripada payment ambigu.
- [ ] Staff boleh review exact candidate dan tarikh MYT.
- [ ] Undo/void dan repeat webhooks selamat.

**Original subsystem reference:** [docs/QRPay_AI_DRAFT_REVIEW_V1.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/QRPay_AI_DRAFT_REVIEW_V1.md)

---

<a id="ic-065"></a>
### IC-065 — AI Design Template Editor & Native Render Export

**Category:** design · **Priority:** P1 · **Baseline stage:** testing · **Public:** Yes

**Summary:** Editor template renderer stroke, rotation, curve, multiple fields dan output PNG terus.

**Current facts and scope:**
- SKU renderer v3 dan public PNG export direkod 1 Okt.
- Editor authenticated belum dibuktikan fully.

**Definition of done (pending owner verification):**
- [ ] Template SKU output berulang deterministik.
- [ ] Semua font/size/stroke bekerja pada mesin print.
- [ ] Validasi authenticated editor dan ClickUp handoff.

**Original subsystem reference:** [docs/RENDER_TEMPLATES_V2.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/RENDER_TEMPLATES_V2.md)

---

<a id="ic-066"></a>
### IC-066 — Courier AWB / SPX Link Recovery

**Category:** automation · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Pulih AWB/tracking lewat dan sync ClickUp/order dengan status courier sebenar.

**Current facts and scope:**
- Tracking suffix dan AWB shortcut pernah diluluskan.
- Kadar kegagalan provider mesti direkod.

**Definition of done (pending owner verification):**
- [ ] Deteksi link kosong/expired, retry bounded.
- [ ] Elak tambah status fulfillment palsu.
- [ ] Link AWB kekal betul per order/task.

**Original subsystem reference:** [docs/AWB_PREVIEW.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AWB_PREVIEW.md)

---

<a id="ic-067"></a>
### IC-067 — ClickUp AI Agent / Super Agents Evaluation

**Category:** automation · **Priority:** P3 · **Baseline stage:** idea · **Public:** Owner only

**Summary:** Nilai penggunaan ClickUp Super Agents untuk triage dan kemas kini task tanpa bypass audit iCetak.

**Current facts and scope:**
- Konsep dibincangkan tetapi tiada bukti integrasi production.

**Definition of done (pending owner verification):**
- [ ] Tentukan apa tindakan Super Agents dibenarkan.
- [ ] Gunakan gateway iCetak bagi semua mutasi.
- [ ] Uji cost/permissions dan stop conditions.

**Original subsystem reference:** [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

---

<a id="ic-068"></a>
### IC-068 — AI Dashboard Customer Case Briefs

**Category:** inbox · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** AI buat summary request pelanggan, fakta terbukti, semakan hilang dan next action yang boleh diikuti designer.

**Current facts and scope:**
- Case brief original chat dibuat bersama rail customer dan search.
- Confirm per session/order wajib sebelum tindakan.

**Definition of done (pending owner verification):**
- [ ] Tidak campur order lama selepas shipped.
- [ ] Missing fakta dipaparkan tanpa tekaan.
- [ ] Owner boleh review dan correct.

**Original subsystem reference:** [docs/AI_ACTION_DASHBOARD.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/AI_ACTION_DASHBOARD.md)

---

<a id="ic-069"></a>
### IC-069 — Pickup Notification and Ready Collection

**Category:** orders · **Priority:** P1 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Paparan counter ready for pickup, cash unpaid, pickup notice berjaya, barang telah diambil.

**Current facts and scope:**
- Pickup counter rollout sudah ada dan tersambung stok.
- Ready for Pickup notice menentukan consumption untuk pickup.

**Definition of done (pending owner verification):**
- [ ] Status paid dan collected tidak bercampur.
- [ ] Bulk action dengan permission.
- [ ] Notifikasi WhatsApp tidak berulang.

**Original subsystem reference:** [docs/STOCK_MANAGEMENT.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/STOCK_MANAGEMENT.md)

---

<a id="ic-070"></a>
### IC-070 — AI Design Feedback & Customer Approval

**Category:** design · **Priority:** P2 · **Baseline stage:** testing · **Public:** Owner only

**Summary:** Customer pilih Design OK atau Request Edit melalui pautan dan masa edit dikawal.

**Current facts and scope:**
- Flow semakan customer disusun dengan ClickUp comments.
- Kunci pilihan dan edit window perlu semak hosted.

**Definition of done (pending owner verification):**
- [ ] Catat source/time, jangan benarkan double choice.
- [ ] Feedback edit ke task sebenar.
- [ ] Production tidak bermula tanpa review rule.

**Original subsystem reference:** [docs/DRAFT_AI_FEEDBACK_V14.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/DRAFT_AI_FEEDBACK_V14.md)

---

<a id="ic-071"></a>
### IC-071 — Finance Webhook Reliability / Activepieces

**Category:** finance · **Priority:** P1 · **Baseline stage:** planned · **Public:** Owner only

**Summary:** Baiki scenario Shopee→Finance yang gagal menghantar body JSON; tambah error monitor.

**Current facts and scope:**
- Ada sejarah AP scenario dihentikan kerana missing jsonStringBodyContent.
- Perlu sahkan status flow sebenar, jangan tanda live.

**Definition of done (pending owner verification):**
- [ ] Webhook body valid dan signature/provider identity semak.
- [ ] Kegagalan dispatch alert owner.
- [ ] Replay idempotent tanpa untung/double entry.

**Original subsystem reference:** [docs/FINANCE_WEBHOOK_SETUP.md](https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/FINANCE_WEBHOOK_SETUP.md)

---

## Changelog mapping

The public roadmap's Changelog tab consumes a generated read-only release index from the production repository. It does not mutate roadmap feature statuses. Update `CHANGELOG.md` with a verified release; the production build regenerates `roadmap-changelog.json` and the UI includes it after deployment.

No token, phone number, order address, API secret or service key belongs in these public reference documents.