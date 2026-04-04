-- Delete articles that are purely about offshore wind, solar, gas, etc. (not wave/tidal/ocean energy)
DELETE FROM public.articles
WHERE id IN (
  SELECT id FROM public.articles
  WHERE lower(title) NOT LIKE '%wave energy%'
    AND lower(title) NOT LIKE '%wave power%'
    AND lower(title) NOT LIKE '%tidal%'
    AND lower(title) NOT LIKE '%ocean energy%'
    AND lower(title) NOT LIKE '%ocean power%'
    AND lower(title) NOT LIKE '%marine energy%'
    AND lower(title) NOT LIKE '%corpower%'
    AND lower(title) NOT LIKE '%hydrokinetic%'
    AND lower(title) NOT LIKE '%wave energy converter%'
    AND lower(title) NOT LIKE '%eco wave%'
    AND lower(title) NOT LIKE '%ocean thermal%'
    AND lower(title) NOT LIKE '%osmotic power%'
    AND (
      lower(title) LIKE '%offshore wind%'
      OR lower(title) LIKE '%wind farm%'
      OR lower(title) LIKE '%wind turbine%'
      OR lower(title) LIKE '%windpower%'
      OR lower(title) LIKE '%solar%'
      OR lower(title) LIKE '%onshore wind%'
      OR lower(title) LIKE '%floating wind%'
      OR lower(title) LIKE '%gas network%'
      OR lower(title) LIKE '%coal closure%'
      OR lower(title) LIKE '%battery boom%'
      OR lower(title) LIKE '%rooftop solar%'
      OR lower(title) LIKE '%copper project%'
      OR lower(title) LIKE '%kazakh wind%'
      OR lower(title) LIKE '%steps down%'
      OR lower(title) LIKE '%hvdc%'
      OR lower(title) LIKE '%wind supply chain%'
    )
);