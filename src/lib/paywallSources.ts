export const PAYWALLED_DOMAINS = [
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "economist.com",
  "barrons.com",
  "telegraph.co.uk",
  "thetimes.co.uk",
  "thetimes.com",
  "washingtonpost.com",
  "bostonglobe.com",
  "hbr.org",
  "newyorker.com",
  "theatlantic.com",
  "lloydslist.com",
  "upstreamonline.com",
  "tradewindsnews.com",
  "montelnews.com",
  "woodmac.com",
  "rystadenergy.com",
  "seekingalpha.com",
  "spglobal.com",
];

export function isPaywalled(sourceUrl: string | null | undefined): boolean {
  if (!sourceUrl) return false;
  return PAYWALLED_DOMAINS.some((domain) => sourceUrl.toLowerCase().includes(domain));
}