// Official MY orangutan pack. All 30 asset URLs verified on 2026-10-15.
export const ORANGUTAN_PACK = 'orangutan_my_new';
export const ORANGUTAN_STICKERS = Array.from({length:30}, (_, index) => {
 const id=String(index+1).padStart(2,'0');
 return {sticker_id:id,sticker_package_id:ORANGUTAN_PACK,
  label:id==='02'?'OK':`Orangutan ${id}`,
  url:`https://deo.shopeemobile.com/shopee/shopee-sticker-live-my/packs/${ORANGUTAN_PACK}/${id}@1x.png`};
});
export type ShopeeSticker = typeof ORANGUTAN_STICKERS[number];
export function officialOrangutanSticker(value:unknown):ShopeeSticker|undefined {
 if(!value||typeof value!=='object')return undefined;
 const row=value as Record<string,unknown>;
 return ORANGUTAN_STICKERS.find(s=>s.sticker_id===row.sticker_id&&s.sticker_package_id===row.sticker_package_id);
}
