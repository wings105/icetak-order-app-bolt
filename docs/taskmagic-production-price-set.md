# TaskMagic: harga setiap task dan set

Queue production kini menghantar kontrak `task-price-set-v1`. Flow polling 1 minit,
create task dan webhook task-created kekal. Perubahan ini tidak mengubah task lama.

## Bahagian TaskMagic yang perlu diubah

1. Buka Code step **Map ClickUp Task V2** (`step_8`). Input sedia ada
   `component` dan `date_needed` boleh kekal.
2. Tambah tiga input berikut. Guna Data Selector supaya objek `order` kekal objek,
   bukannya teks JSON.

| Input baharu | Pilihan Data Selector / expression |
|---|---|
| `order` | Send HTTP request v1 → body → events → 0 → order / `{{step_2['body']['events'][0]['order']}}` |
| `clickup_order_customer` | mapping nama/id order → clickup_order_customer / `{{step_7['clickup_order_customer']}}` |
| `courier_option_id` | Map Courier to ClickUp Copy → courier_option_id / `{{step_5['courier_option_id']}}` |

3. Gantikan kod step itu dengan keseluruhan kod dalam
   [`scripts/taskmagic-production-map.mjs`](../scripts/taskmagic-production-map.mjs).
4. Dalam step Create Task **yang aktif** (`step_1`, bernama
   **Create Task + Custom Fields Copy Copy**), buka Body. Gantikan keseluruhan
   nilai `custom_fields` dengan output **Map ClickUp Task V2 → custom_fields**,
   expression `{{step_8['custom_fields']}}`. Pilih melalui Data Selector; nilainya
   mesti array, bukan array yang dibalut sebagai teks. Jangan masukkan output ini
   ke dalam array lama kerana ia sudah mengandungi semua field lama + harga/set.
5. Field lain seperti name, status, due_date dan description kekal. Step Create
   Task lama yang skip tidak perlu dihidupkan. Polling URL dan webhook tidak perlu
   ditukar. Selepas mapping, publish flow.

## Hasil

| Keadaan | Field RM | Field set |
|---|---|---|
| Satu item, qty 2, RM12 seunit | 24 | Tidak dihantar |
| Beberapa item dalam order | Jumlah setiap item/task | set1, set2, set3 mengikut indeks tersimpan |
| Retry atau task sebelumnya sudah linked | Harga task sama | Nombor set kekal |
| Harga tidak tersedia | Tidak dihantar | Ikut bilangan item |
| Item percuma, harga tersimpan 0 | 0 | Ikut bilangan item |

`task_amount` menggunakan harga item yang tersimpan × kuantiti. Ia tidak
mengagihkan delivery fee atau pelarasan harga peringkat order. `payment_amount`
ialah jumlah bayaran order dan jangan dipetakan ke setiap task.

Jika satu commercial item menghasilkan beberapa komponen tanpa pecahan harga
tersimpan, jumlah item direkod sekali pada komponen pertama; komponen tambahan
bernilai 0 dengan `price_allocation=included_in_primary_component`. Ini mengelak
jumlah berganda atau mengada-adakan pecahan harga. Satu item sahaja tidak diberi
label set walaupun menghasilkan beberapa komponen.

Field `set` sedia ada mempunyai pilihan sehingga 10; nama pilihan ke-8 dalam
ClickUp ialah `se8`, ke-10 `set 10`. Mapping guna ID asal. Jika indeks melebihi
pilihan tersedia, queue memberi `set_manifest_complete=false` dan tidak menghantar
option ID rekaan.

## Semakan tanpa mengambil queue

Panggil endpoint sama dengan `?preview_order_id=<orders.id UUID>` menggunakan
header `x-ap-secret` sedia ada. Response `preview=true, queue_claimed=false`
mengandungi komponen pertama termasuk komponen yang sudah linked. Ia tidak claim
queue atau mencipta task; jangan gunakan URL preview sebagai URL polling sebenar.

## Ujian

`node --test supabase/functions/clickup-production-outbox/task-fields.test.mjs`

Meliputi single/multi item, kuantiti, harga 0/tiada harga, MYR cents, split item,
set yang tiada dalam manifest, HTTP auth/preview/one-per-claim dan mapper TaskMagic.
