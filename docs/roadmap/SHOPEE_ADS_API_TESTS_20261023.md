# Shopee Ads API Test Evidence — iCetak

Date: 23 October 2026 (MYT). Historical test evidence recorded from verified responses, not guaranteed future availability.

## Read-only endpoints that responded HTTP 200 and empty error

- `v2.ads.get_recommended_keyword_list`
- `v2.ads.get_recommended_item_list`
- `v2.ads.get_shop_toggle_info`
- `v2.ads.get_total_balance`
- `v2.ads.get_all_cpc_ads_daily_performance`
- `v2.ads.get_all_cpc_ads_hourly_performance`
- `v2.ads.get_product_level_campaign_id_list`
- `v2.ads.get_product_level_campaign_setting_info`
- `v2.ads.get_product_campaign_daily_performance`
- `v2.ads.get_product_campaign_hourly_performance`

## Verified keyword samples (30-day search volume)

| Product | Example keyword | Volume | Quality |
|---|---|---:|---:|
| Pinkfong printed topper | cake topper | 10,683 | 10 |
| Edible Print Only | edible image cake | 1,795 | 10 |
| Edible Print Only | edible image | 1,178 | 10 |
| Acrylic Cake Topper | birthday decoration | 26,910 | 10 |
| Deepavali Cake Topper | deepavali cake topper | 1,238 | 10 |

Do not interpret these as product visits, conversions, or proof of rising trend. The Deepavali example was returned when calling the endpoint with a matching Deepavali product.

## Access policy
- Do not put partner key, access token, refresh token, shop webhook secrets or signed API URLs in version control.
- Use server-side auth and read-only API requests for exploration.
- Respect rate limits and daily retry controls for the approx. 2,004 product catalog baseline.
- Store search-volume snapshots with time, request item ID, keyword, quality and source endpoint. Compare rolling 30-day values carefully.

## Not yet proven
- Organic ranking position, all organic traffic keywords to specific listing, and global Shopee Malaysia trending chart via official API were not proven.
- No bulk 2,004-product production scanner, SEO auto-write, or Ads mutation was authorized.
