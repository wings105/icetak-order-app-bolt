# DIY Edible Image Editor iCetak — Roadmap (PARKED)

> Rekod: 18 November 2026 (MYT). **Status: On Hold / Parked. Progress: 0%. Priority: P3. Owner belum benarkan pembangunan.**
> Dokumen ini ialah spesifikasi perancangan sahaja. Tiada kod editor, database migration, cron, pembayaran, automasi ClickUp atau deployment dilaksanakan daripada rekod ini.

## Matlamat
Web app DIY edible image yang boleh digunakan oleh sesiapa tanpa login atau pembelian awal. Customer pilih bentuk/saiz, upload gambar, masukkan wording, preview hasil dan hanya selepas order disahkan, iCetak menerima fail final sedia cetak. Utamakan pelanggan telefon (mobile-first). Asingkan editor awam daripada sistem order/production.

## Pengalaman pengguna
1. **Buka editor awam** tanpa login. Pilih bentuk (bulat, petak, love, rectangle) dan saiz daripada katalog iCetak. Semak saiz sebenar serta orientasi untuk output print.
2. **Simple Mode (utama):** pilih template, upload foto, isi wording; sistem susun automatik. Preview selepas setiap perubahan.
3. **Advanced Mode (opsyen):** crop, zoom, drag, kedudukan teks, font dan warna; tidak perlu membina Canva penuh.
4. **Save Draft:** simpan design sementara dengan token/sesi selamat, had upload/storan dan cadangan tempoh luput 7 hari. Draft belum mencipta order, ClickUp task atau job printing.
5. **Approve Final:** customer lihat preview mengikut bentuk/saiz dan sahkan artwork. Papar amaran foto resolusi rendah, safe area/margin dan teks yang mungkin terpotong.
6. **Order/link:** pembeli baharu boleh design dahulu kemudian checkout melalui decocake.my; pembeli Shopee yang sudah membayar dibawa ke editor melalui link order unik yang disahkan.
7. **Print-ready:** server jana/terima fail JPG/PNG resolusi sesuai (sasaran 300 DPI pada dimensi fizikal, hanya jika sumber mencukupi) selepas order dan artwork disahkan. Simpan file, metadata saiz/bentuk, versi dan persetujuan; padankan dengan exact order/komponen dan attach/refer kepada ClickUp secara terkawal.

## Dua aliran
- **Shopee / existing paid order — fasa pertama:** order sah → link customer → editor → approve → submit → artwork ke task/komponen ClickUp tepat → staf QC ringkas dan print. Tiada pembayaran kedua.
- **Website / new customer — fasa susulan:** design percuma → preview/draft → checkout dan payment verified → customer approve/submit → produksi.
- **Public visitor tanpa order:** edit/preview dan draft sahaja. Tiada export print-ready percuma dan tiada create order/task, penghantaran mesej atau proses produksi.

## Boundary & keselamatan
- Public editor dikawal dengan saiz dan jenis fail, virus/content validation yang relevan, CAPTCHA/rate-limit, kuota per sesi, expiry dan cleanup; jangan simpan gambar pelanggan tanpa had.
- Editor/draft tidak boleh terus tulis ke order, ClickUp, payment atau production melalui API public. Server hanya lakukan handoff selepas validasi order sah + akses ke sesi/order.
- Semak identiti/hak capaian untuk Shopee link; cegah IDOR, duplicate submit, replay, fail upload, salah padan multi-item dan cetakan berulang.
- Staf QC boleh flag resolusi tidak mencukupi; sistem tidak menjanjikan true 300 DPI apabila foto asal terlalu kecil.
- Gunakan stack iCetak sedia ada (Cloudflare frontend/worker + Supabase + ClickUp), berpegang pada struktur order/approval yang sedia ada. Jangan cipta task customer daripada draft.
- Elakkan AI untuk editing asas. AI boleh dinilai kemudian sahaja jika ada kes pengguna yang memerlukan dan kos/latensi terkawal.

## Fasa cadangan apabila diaktifkan
- **Fasa 0 (sekarang):** PARKED — dokumentasi/roadmap sahaja.
- **Fasa 1:** editor template-first mobile, bentuk/saiz katalog, upload, wording, basic adjust, preview/draft, output approval; cuba dengan order Shopee yang dikenal pasti.
- **Fasa 2:** semakan order, render resolusi sebenar, metadata, exact ClickUp handoff, staff QC, audit/dedup.
- **Fasa 3:** checkout decocake.my untuk customer belum beli, analytics conversion, usability dan kawalan kuota/kos.
- **Fasa 4 (pilihan):** advanced editor dan template tambahan apabila ada bukti keperluan.

## Acceptance criteria sebelum status boleh berubah daripada On Hold
- Pengunjung tanpa order boleh guna editor tanpa menghasilkan order/task ClickUp dan tanpa output print-ready free.
- Bentuk dan saiz tepat, preview memaparkan safe area; export final mengikut ukuran print sebenar.
- Customer wajib approve versi final; setiap submit mempunyai order ID, item/komponen ID, versi, metadata dan bukti approval.
- Shopee paid link mesti disahkan, mengelak akses silang customer; fail sampai ke task ClickUp tepat dan staff boleh terus QC/print.
- Checkout website tidak melepaskan fail produksi sebelum payment verified.
- Draft auto expiry/cleanup, upload quota/rate limit dan audit tersedia; tiada double submit/duplikasi task.
- Test end-to-end mobile dan desktop, termasuk network slow, imej besar, imej resolusi rendah, order multi-item dan retry.
- Tiada perubahan terhadap operasi sedia ada sehingga owner meluluskan scope serta fasa pembangunan.

## Keputusan owner (18 Nov 2026)
Simpan planning dalam roadmap iCetak dahulu; **remark/parked, jangan bina atau aktifkan apa-apa sekarang**.

**Source of truth:** Supabase `public.icetak_roadmap_items` dan `public.icetak_roadmap_updates`. Dokumen ini ialah rujukan jangka panjang, bukan bukti feature telah dilaksanakan.
