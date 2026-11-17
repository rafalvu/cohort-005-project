# Charge full price when the buyer's country is unknown

Purchasing-power prices depend on the buyer's country, which `resolveCountry` takes from the development session override when present, then the `CF-IPCountry` header. When neither provides a country, the country is unknown and the buyer pays full price, so a page never waits on a network call to learn where the buyer is.

## Considered Options

- **Look up the first `X-Forwarded-For` address on ip-api.com.** We did this, and dropped it: the course list, the purchase page and lesson pages for discounted purchases waited on the lookup and stalled at peak. The free endpoint is also plain HTTP and limited to 45 requests a minute.
- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.

## Consequences

A Student who would qualify for a purchasing-power price, but whose request does not come through Cloudflare and has no development override, is charged full price. The development override is a test facility, not production country verification.
