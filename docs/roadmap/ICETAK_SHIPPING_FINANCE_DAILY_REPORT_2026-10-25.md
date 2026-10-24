# iCetak — Dokumentasi Penuh Perbincangan Shipping, Profitabiliti & Daily Business Report

**Tarikh dokumentasi:** 25 Oktober 2026 (Asia/Kuala_Lumpur)  
**Perniagaan:** iCetak / Decocake  
**Status dokumen:** Rujukan perbincangan + spesifikasi perancangan (**belum dilaksanakan untuk Daily Business Report**)  
**Sumber:** Perbincangan pengguna–ChatGPT dalam thread ini; semakan data sebenar Supabase iCetak dan kod GitHub sepanjang perbincangan.  
**Projek Supabase:** `buivecgahhmrhlmfujgt`  
**Repo GitHub:** [`wings105/icetak-order-app-bolt`](https://github.com/wings105/icetak-order-app-bolt)  
**Sistem:** [shop.decocake.my](https://shop.decocake.my/)

> **Tujuan dokumen:** Menyimpan *sepenuhnya isi penting, keputusan, pengiraan, bukti, isu data, pembetulan, dan roadmap teknikal* daripada perbincangan. Dokumen ini ialah rekod tersusun/parafrasa, bukan transkrip verbatim mesej demi mesej. Tiada perubahan kod, deploy, atau scheduler baharu dilakukan semata-mata kerana dokumen ini diwujudkan.

---

## 1. Ringkasan keputusan akhir

1. **Kekalkan satu harga produk di semua saluran:** Shopee, Decocake website, WhatsApp, dan walk-in/pickup. Jangan naikkan harga sesuatu produk hanya untuk menampung fee platform tertentu; perbezaan keuntungan dinilai pada lapisan *finance*, bukan pricing pelanggan.
2. **Kekalkan shipping SPX RM4.50 pada Decocake** buat masa ini. Kos sebenar ParcelDaily SPX juga RM4.50 bagi rekod yang diperiksa; **margin shipping langsung = RM0**, tetapi margin produk menampung kos operasi pembungkusan.
3. **Jangan anggap free shipping terus sebagai kerugian:** apabila diberikan melalui Decocake, RM4.50 ialah kos pemasaran/akuisisi pelanggan yang mungkin lebih berbaloi daripada komisen dan fee Shopee. Namun, perlu uji mengikut jenis produk, nilai bakul dan margin sebenar setiap order.
4. **Kos packing RM0.20–RM0.60/order** telah pun diambil kira oleh pemilik dalam struktur harga produk. Jangan cadangkan menaikkan postage atas alasan packing tanpa melihat keseluruhan margin order.
5. **Jualan iCetak mempunyai margin sumbangan positif**, namun keuntungan bersih yang boleh diaudit belum boleh diumumkan kerana belum semua kos gaji, iklan, overhead, refund dan sumber dana direkonsiliasi.
6. **Unjuran akhir Oktober 2026:** sekitar **RM18,100–RM18,500** jualan, berdasarkan trend 1–24 Oktober; ini unjuran, bukan wang yang sudah masuk.
7. **Daily Business Report dicadangkan sebagai automasi backend dalaman:** `Supabase pg_cron → Edge Function/RPC → Finance DB → WasapFlow WhatsApp Admin`. ChatGPT dan Activepieces tidak diperlukan untuk menjalankan rutin harian.
8. **Status implementasi:** sedia ada ialah asas scheduler, WhatsApp gateway, dan *QRPay Daily Summary*; **Business Daily Report khusus masih dalam peringkat perancangan**, belum dipasang atau diaktifkan.

---

## 2. Konteks operasi dan strategi harga iCetak

### 2.1 Saluran jualan

- **Shopee:** marketplace, mempunyai fee komisen/perkhidmatan/transaksi, voucher/subsidi, dan boleh mempunyai perbelanjaan ads/affiliate.
- **Decocake web:** website sendiri, boleh menawarkan postage murah atau free shipping mengikut kempen, tanpa fee marketplace Shopee yang sama.
- **WhatsApp/direct:** urus order melalui chat/draft engine, lazimnya pembayaran QRPay atau pembayaran manual.
- **Walk-in/pickup:** customer mengambil di kaunter; biasanya tiada kos courier.

**Prinsip pemilik:** harga jual produk sama tanpa mengira di mana pelanggan membeli. Sebab praktikalnya, staf/owner tidak perlu mengingati beberapa senarai harga atau bertanya saluran jualan sebelum memberi harga.

**Contoh harga produk yang diketahui:**

| Produk | Harga jual contoh | Kos bahan contoh |
|---|---:|---:|
| Edible Image A4 | RM24.00 | RM8.50 |
| Glossy Cake Topper | RM10.00 | RM1.00 |
| Wafer | RM12.00 | RM2.00 |

> Ini contoh daripada maklumat perniagaan yang telah dibincangkan; jangan anggap setiap variasi katalog menggunakan kos tetap yang sama. Sistem Finance sebenarnya menggunakan kadar kos mengikut kategori atau SKU.

### 2.2 Caj postage kepada pelanggan (Semenanjung)

| Courier | Caj yang disebut untuk pelanggan Decocake | Kos ParcelDaily yang dilihat |
|---|---:|---:|
| SPX | **RM4.50** | **RM4.50** |
| J&T | **RM5.90** | RM5.00 (rekod Sep–Okt); RM5.50 (Jul–Ogos) |
| Ninja Van | **RM6.90** | RM6.80 |
| Pickup | **RM0** | RM0 |

Angka ini berdasarkan perbincangan dan data pada waktu semakan, bukan jaminan harga courier masa depan. Rate Sabah/Sarawak, berat luar biasa, zon luar bandar dan surcharge belum ditentukan dalam perbandingan ini.

### 2.3 Market benchmarking yang dibincangkan

Carian penyedia shipping Malaysia dalam perbincangan terdahulu menunjukkan iklan/promo sekitar:

- EasyParcel J&T sekitar RM4.50–4.80 pada sesetengah promosi/syarat.
- ParcelDaily SPX sekitar RM5.00 secara promosi awam (tetapi kontrak/data iCetak menunjukkan RM4.50).
- ParcelDaily J&T sekitar RM5.50 dalam sebahagian penyenaraian awam; data iCetak lebih baru RM5.00.
- MyParcel Asia / Delyva dan lain-lain sekitar RM5.00 bagi pilihan asas tertentu.
- Harga penghantaran yang dikenakan sesetengah penjual edible image lain dianggarkan sekitar **RM5–RM8**.

Ini **rujukan pasaran**, bukan sebut harga langsung yang dijamin dan bukan alasan untuk menukar ParcelDaily. **Keputusan pemilik: ParcelDaily memadai, tidak perlu cari provider baru buat masa ini.**

---

## 3. Audit sebenar ParcelDaily / Supabase

### 3.1 Rekod shipment

Pada semakan thread:

- `public.shipments`: **449 rekod** dari 19 Julai hingga 24 Oktober 2026.
- Semua rekod menggunakan provider `parceldaily`.
- Pecahan courier: **395 SPX**, **48 J&T**, **6 Ninja Van**.
- **408 shipment** mempunyai `charged_amount`; **41** belum mempunyai amaun tersebut.

**Kos yang ditemui:**

- **SPX:** RM4.50 bagi 361 rekod yang ada caj.
- **J&T:** 21 rekod RM5.50 (lebih awal) dan 21 rekod RM5.00 (lebih baru); purata RM5.25 bagi 42 rekod.
- **Ninja Van:** RM6.80 bagi 5 rekod.

`public.shipping_webhook_events` mempunyai **2,871** event pada waktu semakan, termasuk **860 CHECKOUT**; 414 payload CHECKOUT dengan harga disemak. Nilai `price` dalam payload sepadan dengan `prices.courier.postage` dan `charged_amount` untuk sampel berkenaan. Tiada diskaun point ditemui dalam sampel tersebut.

**Had bukti:** `charged_amount` ialah harga yang dilaporkan oleh provider/webhook. Ia **belum semestinya penyata akhir e-wallet/bank** yang telah direkonsiliasi.

### 3.2 Perbandingan caj customer dan caj courier bagi order linked

Bagi 357 order yang dapat dipadankan kepada caj courier:

| Courier | Order dipadankan | Keadaan | Perbezaan jumlah caj pelanggan − kos courier |
|---|---:|---|---:|
| SPX | 317 | 27 free shipping, 289 caj RM4.50, 1 caj RM5.00 | **−RM121.00** |
| J&T | 35 | Campuran order free shipping / caj penuh | **−RM9.70** |
| Ninja Van | 5 | Semua caj RM6.90 vs kos RM6.80 | **+RM0.50** |
| **Jumlah** | **357** |  | **−RM130.20** |

Ini **subsidi shipping bersih**, bukan kerugian operasi keseluruhan. Ia tidak termasuk margin produk dan fee platform yang dielakkan. Dalam Oktober sahaja, satu semakan subset menunjukkan SPX bersih sekitar −RM36 bagi 105 shipment charged, manakala J&T sekitar +RM9 bagi 10 shipment.

---

## 4. Subsidi shipping Shopee dan kadar RM4.50 Decocake

### 4.1 Soalan dan angka sebenar

**Soalan:** Jika Shopee tidak memberi subsidi shipping, berapa pelanggan bayar?

Analisis subset **539 order Shopee yang telah released, mempunyai actual shipping > RM0 dan tidak mempunyai shipping rebate** memberikan:

- `actual_shipping_fee` purata **RM4.86**.
- `buyer_paid_shipping` purata **RM4.66**.
- `shipping_rebate` RM0.
- Baki shipping kepada seller secara anggaran ±**RM0.21/order**, tertakluk kepada pelarasan serta rounding.
- Purata fee komisen + servis + transaksi **RM2.74/order**.
- Purata `product_subtotal` **RM9.36/order**.

Sebagai perbandingan, subset **1,976 order released dengan shipping rebate**:

- `actual_shipping_fee` purata **RM5.05**.
- `buyer_paid_shipping` purata **RM0.11**.
- `shipping_rebate` purata **RM4.94**.
- Seller net shipping pada peringkat pengiraan ini ~RM0.
- Purata fee komisen + servis + transaksi **RM3.28/order**.
- Purata product subtotal **RM12.97/order**.

**Kesimpulan penting:** Shopee tanpa subsidi **tidak automatik menyebabkan seller menanggung RM5 courier**, kerana lazimnya **buyer membayar postage**. Harga dan fee bergantung kepada jenis order dan subsidi.

### 4.2 Shopee vs Decocake SPX

- **Shopee tanpa subsidi:** pelanggan bayar **purata RM4.66** postage, daripada subset yang dikaji.
- **Decocake SPX:** pelanggan bayar **RM4.50**.
- **Perbezaan:** Decocake lebih murah **RM0.16 secara purata** dalam sampel tersebut.
- Shopee dengan voucher/free shipping boleh membuat customer bayar **RM0**, jadi jangan menyatakan Decocake sentiasa lebih murah untuk semua customer.

**Pembetulan cadangan:** pada awal thread pernah dicadangkan naikkan SPX ke RM5 untuk mendapat untung postage. Cadangan itu **ditarik balik** selepas kos sebenar dan matlamat pemasaran dipertimbangkan. **Dasar akhir: kekalkan SPX RM4.50.**

### 4.3 Pembungkusan dan margin produk

Pemilik menjelaskan **kos packing sekitar RM0.20–RM0.60/order** sememangnya diperuntukkan daripada margin produk, bukan surcharge shipping.

Dengan contoh satu unit dalam satu parcel, baki selepas bahan + packing ialah:

| Produk contoh | Harga | Kos bahan | Baki selepas bahan + packing RM0.20–0.60 |
|---|---:|---:|---:|
| Edible A4 | RM24.00 | RM8.50 | RM14.90–RM15.30 |
| Topper glossy | RM10.00 | RM1.00 | RM8.40–RM8.80 |
| Wafer | RM12.00 | RM2.00 | RM9.40–RM9.80 |

Angka di atas **belum** menolak upah, reprint/wastage, overhead, fee platform, promosi dan lain-lain.

**Contoh promosi Decocake:** Edible A4 RM24 dengan modal RM8.50, packing RM0.20–0.60 dan *free shipping* SPX RM4.50 menghasilkan baki **RM10.40–RM10.80** sebelum overhead/gaji/lain-lain. Maka free shipping boleh dipertimbangkan sebagai kos pemasaran, bukan semata-mata kerugian.

**Nota pematuhan:** Promosi website melalui channel sendiri perlu mematuhi peraturan marketplace; jangan anggap dibenarkan untuk mengalihkan pelanggan melalui mesej/listing Shopee.

---

## 5. Struktur data Finance yang telah diperiksa

### 5.1 Jadual utama

**Shopee**

- `public.marketplace_orders`: `id`, `order_sn`, `placed_at`, `current_status`, `payment_status`, `provider`, dll.
- `public.marketplace_order_financials`: `order_id`, `product_subtotal`, `buyer_paid`, `released_amount`, `commission_fee`, `service_fee`, `transaction_fee`, `other_fees`, `fee_breakdown`, `settlement_status`, `released_at`.
- `public.marketplace_order_items`: order line, `quantity`, `line_subtotal`, SKU, kategori berdasarkan mapping.
- `finance.shopee_settlement_lines`: snapshot settlement, released amount, fee.
- `finance.marketplace_order_costs`: `material_lines`, `extra_costs`, `work_minutes`, `reviewed`.

**Direct / Decocake / WhatsApp / walk-in**

- `public.orders`: `source`, `status`, `payment_status`, `total`, `delivery_fee`, `delivery_method`, `payment_method`, `created_at`.
- `public.order_items`: `product_type`, `qty`, `price`.
- `public.qrpay_order_drafts`: `source_type` seperti `chat_trigger`, `pickup_trigger`, `admin_manual`, `qrpay_payment`, pautan `order_id`.
- `public.shipments`: `order_id`, `charged_amount`, `courier`, `status`.
- `public.payment_transactions`: amaun pembayaran serta timestamp.

**Perakaunan operasi**

- `finance.transactions`, `finance.journal_entries`, `finance.journal_lines`, `finance.accounts`, `finance.contribution_target_settings`.

### 5.2 Kadar kos kategori dalam Finance

Daripada `finance.material_cost_versions` versi 1:

| Kategori | Kadar anggaran bahan daripada nilai merchandise |
|---|---:|
| Edible | **42.5%** |
| Acrylic | **15.83%** |
| Glossy Topper / `printed` | **12.7%** |
| Wafer | **23.33%** |

**Penting:** Ini anggaran kategori; tidak semestinya bahan sebenar setiap variasi SKU, dan sesetengah kategori tambahan (`mirror`, dsb.) masih belum dipetakan lengkap dalam kiraan thread ini. `finance.marketplace_order_costs` juga menunjukkan entri packing/add-on adakalanya `estimated: 0`; analisis manual menggunakan **RM0.40/order** sebagai titik tengah kadar packing RM0.20–0.60.

### 5.3 Masalah utama pengelasan channel

`orders.source='draft_engine'` **tidak memberitahu saluran pemasaran sebenar**. Dalam data, `draft_engine` boleh datang daripada WhatsApp/chat, pickup atau admin manual. Oleh itu:

- Jangan label semua `draft_engine` sebagai *website*.
- Jangan label semua `delivery_method='pickup'` sebagai *walk-in fizikal*.
- Jangan label semua `source='customer'` sebagai keseluruhan jualan Decocake; mungkin order web melalui draft engine.
- Untuk report jangka panjang, perlu ada **`sales_channel` yang eksplisit** serta `lead_source`/`fulfillment_method`/`payment_method` yang berasingan.

Cadangan nilai `sales_channel`: `shopee`, `decocake_web`, `whatsapp`, `walkin`, `other`, `unknown` (pemetaan hendaklah boleh diaudit dan tidak mengubah label history secara meneka).

---

## 6. Analisis untung daripada data sebenar Oktober 2026

**Sampel:** Order hingga **24 Oktober 2026** (waktu MYT), status yang memenuhi syarat pembayaran dan bukan dibatalkan; untuk Shopee juga memerlukan rekod payout serta rekod anggaran kos produk.

### 6.1 Shopee (subset yang boleh dikira)

| Metrik | Angka |
|---|---:|
| Order siap dengan payout **dan** anggaran modal | **566** |
| Jualan produk dalam subset | RM7,644.85 |
| Released payout dalam subset | RM5,978.48 |
| Fee komisen + servis + transaksi yang dicatat bagi subset | RM1,873.63 |
| Anggaran modal bahan | −RM1,862.39 |
| Anggaran packing (566 × RM0.40) | −RM226.40 |
| **Baki sumbangan selepas payout, bahan dan packing** | **RM3,889.69** |
| Purata baki sumbangan per order | **RM6.87** |

**Definisi:** `payout − material_estimated − packing_estimated`. Nilai payout sudah mengambil kira pelarasan platform mengikut settlement; **jangan tolak fee yang sama untuk kali kedua**. Masih belum ditolak iklan luar settlement, upah, overhead, kerugian reprint/refund yang tidak lengkap dan lain-lain.

Terdapat **626** order Shopee Oktober dengan `released_amount` pada waktu semakan, tetapi hanya **566** mempunyai kedua-dua rekod payout + kos yang mencukupi untuk sampel di atas. Sampel ini **bukan keseluruhan untung Shopee**.

### 6.2 Jualan direct/WhatsApp/pickup/web (subset paid, bukan cancelled)

| Pengelasan daripada sumber teknikal | Order | Jualan termasuk postage customer | Baki selepas modal/packing/courier anggaran |
|---|---:|---:|---:|
| `chat_trigger` → **order chat** | 133 | RM3,387.00 | RM1,939.64 |
| `pickup_trigger` → **pickup trigger** | 37 | RM620.00 | RM452.83 |
| `source=customer/customer_portal` → **web self-checkout** | 9 | RM104.00 | RM76.25 |
| `admin_manual` → **manual admin** | 6 | RM157.40 | RM98.82 |
| **Jumlah** | **185** | **RM4,268.40** | **RM2,567.54** |

**Nota kaedah:**

- Packing RM0.40/order.
- Courier sebenar dari ParcelDaily jika terdapat `charged_amount`; selain itu menggunakan anggaran SPX RM4.50, J&T RM5.00, Ninja Van RM6.80.
- Terdapat **RM90 nilai produk** dalam kategori yang belum mempunyai pemetaan kos penuh; sebab itu baki berpotensi **terlebih anggar**.
- `pickup_trigger` tidak semestinya walk-in fizikal, dan `chat_trigger` boleh menggunakan checkout/link web.
- Nilai `total` untuk direct termasuk caj postage; `product_subtotal` Shopee ialah nilai produk tanpa penggabungan caj postage buyer yang sama. Perbandingan angka keseluruhan adalah sebagai **indikator operasi**, bukan penyata perakaunan setara sepenuhnya.

### 6.3 Gabungan subset yang boleh dikira

| Metrik | Nilai |
|---|---:|
| Baki Shopee subset | RM3,889.69 |
| Baki direct subset | RM2,567.54 |
| **Gabungan margin sumbangan subset** | **RM6,457.23** |

**JANGAN label RM6,457.23 sebagai untung bersih iCetak bagi seluruh Oktober.** Shopee mempunyai order lain yang belum diberi kos/payout penuh. Upah, iklan, overhead dan belanja lain belum ditolak secara konsisten.

Finance merekodkan tetapan sasaran overhead **RM6,500/bulan** (`finance.contribution_target_settings` pada 4 Oktober), tetapi ia ialah *setting/bajet*, bukan perbelanjaan sebenar yang telah dibuktikan oleh jurnal perbelanjaan.

---

## 7. Prestasi sebenar mengikut bulan

### 7.1 Jualan penuh yang direkodkan

| Bulan 2026 | Shopee | Direct / WhatsApp / Pickup / Web | Jumlah direkodkan |
|---|---:|---:|---:|
| Julai* | RM5,374.00 | Tiada siri yang setanding | RM5,374.00* |
| **Ogos** | **RM15,541.05** | **RM6,477.21** | **RM22,018.26** |
| **September** | **RM12,316.03** | **RM4,308.54** | **RM16,624.57** |
| **Oktober 1–24** | **RM10,001.06** | **RM4,268.40** | **RM14,269.46** |

*Julai hanya merangkumi rekod Shopee sebahagian bulan dan tiada rekod direct yang benar-benar setanding. Tidak wajar digunakan untuk menilai perubahan bulan penuh.*

**Definisi sumber:** Shopee = `marketplace_orders` berbayar, bukan cancelled/in_cancel/to_return, bersama `marketplace_order_financials.product_subtotal`; direct = `public.orders.total` berstatus `paid`, bukan `Cancelled`.

### 7.2 Perbandingan adil 1–24 haribulan

| Saluran | Ogos 1–24 | September 1–24 | Oktober 1–24 |
|---|---:|---:|---:|
| Shopee | RM14,075.83 | RM10,162.27 | RM10,001.06 |
| Direct + pickup + web | RM4,929.00 | RM3,515.54 | RM4,268.40 |
| **Jumlah** | **RM19,004.83** | **RM13,677.81** | **RM14,269.46** |

Perubahan jumlah Oktober:

- **+4.3% berbanding September** pada tarikh sama.
- **−24.9% berbanding Ogos** pada tarikh sama.
- Shopee **−1.6% jualan produk** vs September 1–24, walaupun order berkurang lebih ketara.
- Direct **+21.4%** vs September 1–24.

### 7.3 Bilangan order dan AOV 1–24

| Metrik | Ogos | September | Oktober |
|---|---:|---:|---:|
| Shopee bilangan order | 1,058 | 845 | 751 |
| Shopee purata nilai produk/order | RM13.30 | RM12.03 | RM13.32 |
| Direct bilangan order | 185 | 147 | 185 |
| Direct purata nilai order (termasuk postage) | RM26.64 | RM23.92 | RM23.07 |

**Interpretasi:** volume Shopee jatuh ~11.1% berbanding September tetapi AOV meningkat; penurunan nilai Shopee secara keseluruhan cuma ~1.6%. Jualan direct meningkat disebabkan lebih banyak order.

### 7.4 Penghantaran vs pickup direct (1–24)

| Fulfillment | Ogos | September | Oktober |
|---|---:|---:|---:|
| Direct delivery | RM3,310.50 | RM2,670.30 | RM3,539.40 |
| Pickup | RM1,618.50 | RM845.24 | RM729.00 |

- Jualan direct delivery Oktober **+32.5% vs September**.
- Pickup Oktober **−55.0% vs Ogos** (berdasarkan `delivery_method='pickup'`, bukan bukti kunjungan walk-in semata-mata).

### 7.5 Trend jangka pendek Oktober

| Tempoh | Shopee jualan | Direct jualan | Gabungan | Purata gabungan/hari |
|---|---:|---:|---:|---:|
| 1–12 Okt | RM5,461.45 | RM2,133.70 | RM7,595.15 | ±RM633 |
| 13–19 Okt | RM2,580.50 | RM1,328.70 | RM3,909.20 | ±RM558 |
| 20–24 Okt | RM1,959.11 | RM806.00 | RM2,765.11 | ±RM553 |

**Nota:** nilai sehingga 24 haribulan; sebahagian status Shopee boleh berubah selepas laporan diambil (order menjadi completed, cancelled atau settlement enriched). Untuk monitoring sebenar, wujudkan snapshot yang boleh diulang atau nyatakan tarikh data *as of*.

---

## 8. Unjuran akhir Oktober 2026

**Data hingga 24 Oktober:** RM14,269.46 gabungan jualan yang direkodkan.

Berdasarkan purata 24 hari pertama dan prestasi 7 hari terakhir:

| Sumber | Anggaran akhir bulan |
|---|---:|
| Shopee | ±RM12,650–RM13,000 |
| Direct/WhatsApp/pickup/web | ±RM5,450–RM5,500 |
| **Gabungan** | **±RM18,100–RM18,500** |

Angka tengah yang dipakai dalam perbincangan: **±RM18,300** (atau sekitar RM18,200–RM18,500 secara konservatif).

Jangkaan berbanding jualan penuh:

- **~9–11% lebih tinggi daripada September RM16,624.57**.
- **~16–18% lebih rendah daripada Ogos RM22,018.26**.

### 8.1 Anggaran sumbangan selepas kos pada akhir bulan

Satu anggaran kasar yang dibincangkan ialah **baki RM9,600–RM9,900** selepas bahan, packing, fee Shopee dan courier untuk **keseluruhan jualan unjuran**, tertakluk kepada ketersediaan kos semua order.

Jika ditolak **sasaran overhead RM6,500** dalam Finance, maka baki indikatif sekitar **RM3,100–RM3,400**.

**Ini sama sekali bukan unjuran untung bersih yang sudah disahkan.** Ia ilustrasi yang masih bergantung pada klasifikasi kos/order, kos yang belum lengkap, bilangan order sebenar hingga 31 Okt, perbelanjaan iklan/gaji dan rekonsiliasi pembayaran. Elakkan dipaparkan sebagai *net profit* tanpa label `estimated` serta `data completeness`.

---

## 9. Hala tuju keputusan perniagaan

1. **Jangan naikkan postage SPX RM4.50 dahulu.** Ia kompetitif dan boleh menjadi insentif berpindah ke direct.
2. **Jangan pecahkan harga produk kepada Shopee vs direct** kerana kompleksiti operasi melangkaui manfaat; kekalkan satu master product price.
3. **Ukur profit per order / per channel**, bukan shipping semata-mata.
4. **Tambah pertumbuhan direct delivery** — segmen ini meningkat walaupun Shopee mendatar.
5. **Pantau volume Shopee**, kerana Oktober masih rendah berbanding Ogos.
6. **Tetapkan free-shipping bersasar** mengikut margin, basket size, nilai pelanggan berulang dan keberkesanan kempen. Idea awal minimum basket RM35–RM40 hanyalah cadangan untuk ujian, **bukan polisi yang sudah dipersetujui/dilaksanakan**.
7. **Lengkapkan semua kos sebenar**, terutamanya ads, gaji, overhead, reprint, missing SKU, affiliate dan settlement audit, sebelum keputusan besar tentang harga.

---

## 10. Keperluan baharu — Automasi Daily Business Report ke WhatsApp admin

### 10.1 Objektif

Setiap pagi, **backend iCetak secara automatik**:

1. Mengambil data terbaru daripada Shopee, Decocake, WhatsApp/direct dan pickup.
2. Mengira prestasi **semalam**, **bulan setakat ini (MTD)**, perbandingan **bulan lepas pada tarikh sama**, dan **unjuran akhir bulan**.
3. Mengira margin sumbangan berdasarkan payout/fee, kos bahan, packing, courier serta status kelengkapan data.
4. Mengesan risiko: jualan menurun, fee naik, order belum lengkap, shipment/charge tidak berjaya dipadankan.
5. Menyimpan laporan sebagai **snapshot versi tertentu**, kemudian menghantar ringkasan ke **nombor WhatsApp admin** melalui WasapFlow.
6. Membenarkan admin menekan pautan ke dashboard untuk laporan lebih terperinci.
7. Berjalan sendiri walaupun ChatGPT, browser, dan komputer peribadi ditutup.

### 10.2 Pilihan seni bina

```text
Supabase pg_cron (cadangan 08:30 MYT)
      |
      v
Enqueue daily report (report_date = semalam)
      |
      v
Finance SQL/RPC calculation + completeness checks
      |
      v
finance.daily_business_report_runs
      |   (status, snapshot, message_preview, idempotency_key)
      v
Supabase Edge Function: daily-business-report
      |
      v
WasapFlow WhatsApp Business API
      |
      v
WhatsApp nombor admin iCetak
      |
      v
Admin v2 > Finance > Daily Report (drill-down)
```

**Komponen yang telah terbukti tersedia di sistem semasa:**

- `pg_cron` dan `pg_net` extensions **sudah dipasang**.
- `cron.job` sudah mempunyai scheduler automatik aktif.
- Edge Functions `whatsapp-send`, `whatsapp-dispatch`, `wasapflow-proxy`, `qrpay-daily-summary`, `finance-admin` **aktif** semasa semakan.
- `finance.qrpay_daily_summary_runs` mempunyai **154 rekod berstatus `sent`**: 77 pada 10AM dan 77 pada 10PM, dari 9 Ogos hingga 24 Oktober 2026.
- `public.whatsapp_outbox` semasa semakan mengandungi **440 rekod**, **439 `sent`** dan tiada status `failed`; ini status rekod dalaman, bukan bukti semua mesej dibaca oleh penerima.

**Kod sedia ada yang boleh dijadikan contoh:**

- [`supabase/functions/qrpay-daily-summary/index.ts`](https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/qrpay-daily-summary/index.ts)
- [`supabase/functions/whatsapp-send/index.ts`](https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/whatsapp-send/index.ts)
- [`supabase/functions/whatsapp-dispatch/index.ts`](https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/whatsapp-dispatch/index.ts)
- [`supabase/migrations/20260808222359_qrpay_daily_summary.sql`](https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/migrations/20260808222359_qrpay_daily_summary.sql)
- [`supabase/migrations/20260810012919_qrpay_summary_date_ranges.sql`](https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/migrations/20260810012919_qrpay_summary_date_ranges.sql)

**Jadual cron sedia ada (yang diperiksa):**

| Job | Jadual cron (UTC) | Waktu MYT / status |
|---|---|---|
| `icetak-qrpay-summary-10am-myt` | `0 2 * * *` | 10 pagi, aktif |
| `icetak-qrpay-summary-10pm-myt` | `0 14 * * *` | 10 malam, aktif |
| `icetak-qrpay-summary-retry` | `*/5 * * * *` | Retry tiap 5 minit, aktif |
| `icetak-whatsapp-dispatch-every-minute` | `* * * * *` | Worker tiap minit, aktif |
| `icetak-shopee-finance-dispatch-every-minute` | `* * * * *` | **Tidak aktif** sewaktu semakan |

Untuk laporan **08:30 MYT**, ungkapan cron UTC yang sesuai lazimnya `30 0 * * *` (MYT = UTC+8, tiada DST). Penggunaan timezone atau scheduler dinamik hendaklah diuji dalam persekitaran sebenar.

### 10.3 Kandungan minimum laporan WhatsApp

```text
📊 ICETAK DAILY BUSINESS REPORT
Tarikh: [semalam, MYT]

💰 JUALAN SEMALAM
Shopee: RM[...]
WhatsApp / Direct: RM[...]
Walk-in / Pickup: RM[...]
Decocake Web: RM[...]
Jumlah: RM[...]

📈 PRESTASI BULAN INI (MTD)
Jualan MTD: RM[...]
Bulan lepas sehingga tarikh sama: RM[...]
Perubahan: [+/- ...%]
Purata 7 hari: RM[...] sehari
Unjuran akhir bulan: RM[...]

💵 KOS & BAKI SUMBANGAN
Fee Shopee: RM[...]
Kos bahan: RM[...] (actual/estimated)
Kos courier bersih: RM[...]
Packing: RM[...]
Baki sumbangan: RM[...]
Kelengkapan data kos: [...%]

⚠️ PERLU PERHATIAN
Order detail tidak lengkap: [...]
Payout Shopee belum released: [...]
Kos SKU tidak lengkap: [...]
Rekod penghantaran tanpa caj: [...]
Trend 7 hari: [naik / turun]

🔗 Semak penuh: [pautan selamat Admin v2]
```

**Prinsip pelaporan:**

- Perbezaan `sale_date`, `payment_date`, `settlement_date` dan `courier_charge_date` mesti jelas.
- `gross product sales`, `shipping collected`, `net payout`, `platform fees`, `material`, `packing`, `shipping cost`, `contribution` ialah **metrik yang berbeza**.
- Jangan mencampurkan double-counting fee Shopee apabila jumlah `released_amount` sudah selepas potongan.
- Shopee order yang belum released boleh dikira dalam **jualan booked** tetapi **bukan bank cash received**.
- Semua `estimated` perlu dipaparkan bersama kadar kelengkapan dan amaran.
- *Snapshot* laporan boleh berubah jika Shopee menghantar enrichment kemudian; simpan `generated_at` dan support regenerate manual (versi).

### 10.4 Skema yang dicadangkan (belum dibuat)

**`finance.daily_business_report_runs`** sekurang-kurangnya mengandungi:

| Medan | Tujuan |
|---|---|
| `id` | Primary key |
| `report_date` | Tarikh data laporan (MYT) |
| `report_type` | `daily` / masa depan `weekly`, `monthly` |
| `recipient_phone` | Nombor admin yang dibenarkan |
| `idempotency_key` | Elak penghantaran berganda untuk tarikh + jenis + penerima |
| `status` | `pending`, `processing`, `retry`, `sent`, `failed`, `skipped` |
| `attempts` / `next_attempt_at` | Retry + exponential backoff |
| `started_at` / `generated_at` / `sent_at` | Audit masa |
| `snapshot` (`jsonb`) | Data snapshot semua KPI |
| `message_preview` | Teks yang dihantar |
| `provider_message_id` | Rujukan WasapFlow |
| `delivery_status` | `accepted` / `sent` / `delivered` / `read` jika webhook menyediakan bukti |
| `last_error` | Sebab kegagalan |
| `created_at` / `updated_at` | Audit rekod |

Opsyen berasingan: **`finance.daily_business_report_settings`** untuk `enabled`, `schedule_local_time`, `timezone`, `recipient_phone`/admin group, `include_weekly_comparison`, `include_pnl_estimate`, `alert_threshold_pct`, `last_success_at`.

**Keselamatan:** Simpan perancangan ini dalam schema `finance` yang tidak diekspos sewenang-wenangnya; Edge Function mesti menggunakan server-side secrets dan endpoint dalaman berautentikasi. Jangan membenarkan request publik menghantar mesej ke nombor sewenang-wenangnya. Elakkan meletakkan service role atau kunci provider dalam frontend/URL.

### 10.5 Polisi WhatsApp Business / template

Sistem `whatsapp-send` sedia ada sudah mempunyai perbezaan:

- **Freeform text** jika tingkap perbualan 24 jam membenarkan;
- **Approved template** apabila tingkap tidak terbuka.

Ketika semakan, template yang diluluskan termasuk beberapa template order, review, pickup dan follow-up; **belum ditemukan template khusus `daily_business_report`**.

**Tindakan:** semak keperluan kategori dan kelulusan template melalui provider/Meta; sediakan template sesuai sekiranya diperlukan. Uji penghantaran proaktif ke nombor admin tanpa bergantung pada wujudnya tingkap perbualan. Jangan anggap `HTTP 200` bermakna mesej delivered/read.

### 10.6 Jadual & operasi disyorkan

- **Waktu:** setiap hari **08:30 pagi MYT**.
- **Tarikh laporan utama:** **semalam** (00:00–23:59:59 MYT).
- **Metrik tambahan:** MTD hingga semalam + perbandingan tarikh sama bulan lepas + unjuran 31hb/akhir bulan.
- **Retry:** setiap 5 minit untuk kegagalan sementara, dengan had percubaan; ikut mekanisme QRPay yang telah berfungsi.
- **Idempotency:** satu routine report untuk `(report_date, report_type, recipient_phone)`. Manual resend hanya selepas arahan explicit.
- **Kawalan admin:** `ON/OFF`, nombor penerima, waktu, Preview, Test Send, Send Now, Retry Failed, sejarah status.
- **Alert penting:** jika sumber data Shopee stale, tandakan `DATA_INCOMPLETE` dan/atau tahan penghantaran dengan amaran, bukannya hantar laporan seolah-olah lengkap.
- **Timezone:** jadual serta semua aggregate menggunakan **Asia/Kuala_Lumpur**, bukan tarikh UTC mentah.

---

## 11. Skop dashboard Admin v2 yang dicadangkan

**Menu:** `Admin v2 → Finance → Daily Report`.

Paparan minimum:

1. **KPI cards:** jualan semalam, MTD, direct vs Shopee, baki sumbangan, data completeness.
2. **Daily trend chart:** 7, 14, 30 hari.
3. **Channel mix:** Shopee, Decocake web, WhatsApp, walk-in/pickup — selepas pemetaan betul.
4. **Fee & costs:** komisen, servis, transaksi, seller voucher, ads, bahan, packing, courier.
5. **Profit contribution per channel / SKU:** nilai dianggarkan vs actual, laporan order yang tiada kos.
6. **Projection & target:** baki hari dalam bulan, average/day, trailing 7-day, sasaran overhead dan *expected remaining contribution*.
7. **Daily reports log:** status sent/retry/failed, attempt, timestamp, preview, provider message ID, data snapshot.
8. **Settings:** masa hantar, penerima, ON/OFF, threshold alert, preview/test.
9. **Reconcile and drill-down:** klik mana-mana KPI menuju kepada order yang menyumbang kepada angka tersebut.

**Matlamat UI:** mudah dibaca oleh owner, bukan dashboard berlapis-lapis. WhatsApp hanya ringkasan; dashboard ialah tempat laporan penuh.

---

## 12. Rancangan pelaksanaan bertahap

### Fasa 0 — Audit & definisi metrik (WAJIB sebelum hantar automatik)

- [ ] Definisikan `sales_channel` sebenar supaya `draft_engine` tidak disalah label.
- [ ] Tetapkan status order dan deduplication antara Shopee ↔ order internal.
- [ ] Bezakan `product_total`, shipping customer, shipping paid, settlement fee, promo dan payout.
- [ ] Semak 30 sampel order berbilang SKU/variant, refund, partial paid, cancelled, pickup.
- [ ] Lengkapkan kategori material yang tidak dipetakan dan sasaran packing RM0.20–0.60.
- [ ] Tambah metrik `% order dengan actual cost`, `% order dengan released payout`, dan `% order shipping charged`.

### Fasa 1 — SQL report engine

- [ ] Bina function/RPC laporan harian MYT, agregasi semalam, MTD, MTD bulan lepas pada tarikh sama, trailing 7 hari.
- [ ] Bina projection method: purata seluruh bulan + 7 hari terbaru; nyatakan kaedah dan uncertainty.
- [ ] Output `jsonb` yang sama boleh digunakan untuk WhatsApp dan dashboard.
- [ ] Jalankan backtest terhadap Ogos, September, Oktober (sampel) sebelum aktif.
- [ ] Semak angka output dengan SQL ad-hoc dan screenshot sistem Finance sedia ada.

### Fasa 2 — Queue dan Edge Function

- [ ] Tambah migration untuk `finance.daily_business_report_runs` dan settings dengan RLS/grants dalaman yang betul.
- [ ] Tambah Edge Function `daily-business-report`, authorization ketat dan secret bukan di client.
- [ ] Guna recipient setting admin WhatsApp sedia ada (jangan hard-code nombor).
- [ ] Format mesej ringkas, jelas bezakan anggaran/actual.
- [ ] Simpan snapshot, log, provider ID; implement retry dan idempotency.
- [ ] Tambah dry-run untuk admin test tanpa send.

### Fasa 3 — WhatsApp approval & test

- [ ] Semak template Meta/WasapFlow yang sesuai untuk proactive daily business report.
- [ ] Submit/approve jika diwajibkan.
- [ ] Uji mesej WhatsApp manual/dry-run ke penerima admin yang sah.
- [ ] Uji status API accepted vs delivered; tangani template/window closed.
- [ ] Uji retry jaringan gagal, provider rate-limit, duplicate runs.

### Fasa 4 — Scheduler hidup

- [ ] Jadual cron harian 08:30 MYT (UTC 00:30), report `semalam`.
- [ ] Aktifkan hanya selepas preview dan delivery test berjaya.
- [ ] Jalankan pemerhatian 3–7 hari dan banding output dengan finance dashboard.
- [ ] Pastikan QRPay Daily Summary 10 pagi/10 malam kekal berfungsi tanpa gangguan.

### Fasa 5 — Dashboard dan analisis lebih canggih

- [ ] Admin v2 Finance Daily Report page.
- [ ] Graf harian/per saluran dan breakdown SKU.
- [ ] Anomaly alerts (7-day sales drop, fee spike, missing data) tanpa alert spam.
- [ ] Weekly/monthly rollup jika kemudian diperlukan.

---

## 13. Acceptance criteria (takrif 'siap')

Sistem dianggap siap hanya apabila:

- [ ] Pada 08:30 MYT hari ujian, satu dan hanya satu laporan rutin dihantar kepada nombor admin yang ditetapkan.
- [ ] Mesej menyebut tarikh semalam dengan betul dan setiap angka sepadan dengan RPC snapshot.
- [ ] Jualan Shopee **tidak double-count** order dalaman dan tidak menolak fee dua kali.
- [ ] Order `draft_engine` disalurkan mengikut sumber sebenar atau diberi kategori `unknown` — bukan diteka sebagai website.
- [ ] Direct shipping dan courier expense dipadankan tanpa pendua shipment.
- [ ] Semua modal belum diketahui ditandakan, bukan diandaikan kos sifar.
- [ ] `net profit` tidak muncul kecuali semua data kos yang diperlukan sah; jika belum, label `estimated contribution`.
- [ ] Dry-run / Test Send berfungsi; `OFF` bermakna tiada mesej automatik.
- [ ] Jika WasapFlow gagal, report direkod `retry/failed` dengan alasan, bukan senyap.
- [ ] Outbox/log tersedia untuk audit manual; admin boleh membuka laporan penuh secara selamat.
- [ ] Kod serta migration berada dalam GitHub, environment secrets server-side, deploy verified.

---

## 14. Risiko dan isu terbuka

| Risiko / isu | Kesan | Penyelesaian yang dicadangkan |
|---|---|---|
| `source='draft_engine'` bercampur channel | Margin per channel salah | `sales_channel` + mapping eksplisit, backfill berdasarkan bukti |
| Shopee financial enriched lambat | Jualan MTD vs payout nampak berbeza | Bezakan booked / settled / cash; freshness indicator |
| Sebahagian order modal tiada | Profit terlebih anggar | `coverage_pct`, unknown cost, QA SKU |
| Packing ada dalam harga produk, tetapi tiada cost record tepat | Untung order terlebih anggar | Packing RM0.20–0.60 actual/configurable; median RM0.40 dengan label estimate |
| Courier `charged_amount` kosong | Salah margin shipping | Anggaran mengikut rate hanya apabila kosong; flag estimate |
| Free shipping direct | Menolak margin sebuah order | Rekod sebagai marketing/shipping subsidy; analisis per basket |
| Shopee voucher, seller promo, affiliate, ads | Penilaian margin tidak lengkap | Audit fee breakdown + ledger actual |
| Reprint/refund/cancelled | Risiko count sebagai jualan dan untung | Status lifecycle dan reversal rules |
| QRPay cash/transfer bukan itemised ledger lengkap | Baki bank disalah anggap hasil jualan | Reconciliation ke order, exclude loan/transfer/non-sales |
| Tiada template WhatsApp khas | Laporan tak sampai apabila window closed | Approved template dan delivery test |
| Retry tanpa idempotency | WhatsApp spam duplicate | Unique key + claimed jobs + retry semantics |
| Waktu MYT vs UTC | Report salah tarikh | Semua batasan tarikh pakai MYT |
| Nombor admin/secret tersimpan dalam kod | Risiko keselamatan | Secure settings/Vault, private service-side only |

---

## 15. Status semasa dan tindakan seterusnya

### Sudah ada dan disahkan ketika semakan

- [x] Finance DB dan data jualan Shopee/direct.
- [x] Supabase `pg_cron` dan `pg_net`.
- [x] WasapFlow API integration pada sistem iCetak.
- [x] Edge Function `qrpay-daily-summary` aktif.
- [x] QRPay 10AM/10PM cron aktif, bersama retry.
- [x] Rekod 154 run QRPay summary berstatus `sent`.
- [x] GitHub mempunyai rujukan kod/migration automasi WhatsApp.

### Belum dibuat (khusus Daily Business Report)

- [ ] SQL report generator dan snapshot baru.
- [ ] Jadual `finance.daily_business_report_runs`.
- [ ] Edge Function `daily-business-report`.
- [ ] Cron report 08:30 MYT.
- [ ] Approval template WhatsApp khusus.
- [ ] Halaman Admin v2 Finance Daily Report.
- [ ] E2E test lengkap, push, deploy dan proof of actual WhatsApp delivery.

**Keputusan operasi terakhir dalam thread:** Plan ini sesuai dibina **secara native dalam iCetak** dan tidak memerlukan ChatGPT scheduler, ChatGPT Work, atau Activepieces. ChatGPT hanya digunakan untuk merancang dan membangunkan apabila diarahkan, bukan sebagai engine runtime.

---

## 16. Rujukan kod, data dan dokumentasi

**GitHub iCetak**

- Repo: https://github.com/wings105/icetak-order-app-bolt
- QRPay daily summary function: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/qrpay-daily-summary/index.ts
- QRPay daily summary SQL migration: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/migrations/20260808222359_qrpay_daily_summary.sql
- WhatsApp send function: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/whatsapp-send/index.ts
- WhatsApp dispatch function: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/whatsapp-dispatch/index.ts
- Shipping agent: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/shipping-agent/index.ts
- Shipping API: https://github.com/wings105/icetak-order-app-bolt/blob/main/supabase/functions/shipping-api/index.ts

**Dokumentasi Supabase**

- Scheduling Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions

**Sumber data utama dalam Supabase**

- `public.marketplace_orders`
- `public.marketplace_order_financials`
- `public.marketplace_order_items`
- `finance.marketplace_order_costs`
- `finance.material_cost_versions`
- `finance.shopee_settlement_lines`
- `public.orders`
- `public.order_items`
- `public.qrpay_order_drafts`
- `public.shipments`
- `public.payment_transactions`
- `finance.transactions`
- `finance.contribution_target_settings`
- `finance.qrpay_daily_summary_runs`
- `public.whatsapp_outbox`
- `public.whatsapp_templates`
- `cron.job`

---

## 17. Cadangan tajuk Roadmap iCetak

**Feature:** `Daily Business Report + WhatsApp Admin`  
**Area:** Finance / Business Intelligence / Automation  
**Priority:** High (ops visibility)  
**Current status:** Planned  
**Dependencies:** Channel tagging, finance contribution accuracy, WasapFlow template/permission  
**Runtime:** Native Supabase, independent of ChatGPT  
**Suggested route:** `/admin/v2` → `Finance > Daily Report` (nama laluan UI boleh disesuaikan dengan routing sebenar app)  
**Delivery time target:** 08:30 MYT, setiap hari (laporan semalam)  
**Owner controls:** ON/OFF, recipient, preview, test, retry, audit history

---

### Nota penutup

Dokumen ini menyatukan keseluruhan keputusan dan angka penting thread, termasuk percanggahan yang telah diperbetulkan (cadangan menaikkan SPX ke RM5 kemudian ditarik balik). **Angka sebenar** dirujuk kepada keadaan data sewaktu semakan pada 25 Oktober 2026 sekitar 00:33 MYT; nilai boleh berubah jika order, settlement atau data kos dikemaskini. Semua **unjuran** dan **cadangan teknikal** ditandakan sebagai belum dilaksanakan.