
-- Disable the sync trigger temporarily
ALTER TABLE public.approved_domains DISABLE TRIGGER ALL;

-- UK NATIONAL
update public.approved_domains set feed_url = 'https://www.theguardian.com/uk/rss' where domain ilike '%theguardian.com%';
update public.approved_domains set feed_url = 'https://feeds.bbci.co.uk/news/rss.xml' where domain ilike '%bbc.co.uk%' or domain ilike '%bbc.com%';
update public.approved_domains set feed_url = 'https://www.independent.co.uk/news/rss' where domain ilike '%independent.co.uk%';
update public.approved_domains set feed_url = 'https://www.telegraph.co.uk/rss.xml' where domain ilike '%telegraph.co.uk%';
update public.approved_domains set feed_url = 'https://www.thetimes.co.uk/feed' where domain ilike '%thetimes.co.uk%';
update public.approved_domains set feed_url = 'https://www.dailymail.co.uk/news/index.rss' where domain ilike '%dailymail.co.uk%';
update public.approved_domains set feed_url = 'https://www.mirror.co.uk/news/?service=rss' where domain ilike '%mirror.co.uk%';
update public.approved_domains set feed_url = 'https://www.express.co.uk/posts/rss/1/news' where domain ilike '%express.co.uk%';
update public.approved_domains set feed_url = 'https://feeds.skynews.com/feeds/rss/home.xml' where domain ilike '%sky.com%';
update public.approved_domains set feed_url = 'https://www.cityam.com/feed/' where domain ilike '%cityam.com%';
update public.approved_domains set feed_url = 'https://www.standard.co.uk/news/rss' where domain ilike '%standard.co.uk%';
update public.approved_domains set feed_url = 'https://www.ft.com/news-feed' where domain ilike '%ft.com%';

-- UK SCOTLAND
update public.approved_domains set feed_url = 'https://www.heraldscotland.com/news/rss/' where domain ilike '%heraldscotland.com%';
update public.approved_domains set feed_url = 'https://www.scotsman.com/feed' where domain ilike '%scotsman.com%';
update public.approved_domains set feed_url = 'https://www.dailyrecord.co.uk/news/rss.xml' where domain ilike '%dailyrecord.co.uk%';
update public.approved_domains set feed_url = 'https://www.pressandjournal.co.uk/feed/' where domain ilike '%pressandjournal.co.uk%';
update public.approved_domains set feed_url = 'https://www.thecourier.co.uk/feed/' where domain ilike '%thecourier.co.uk%';
update public.approved_domains set feed_url = 'https://www.holyrood.com/feed' where domain ilike '%holyrood.com%';

-- UK WALES & NORTHERN IRELAND
update public.approved_domains set feed_url = 'https://www.walesonline.co.uk/news/rss.xml' where domain ilike '%walesonline.co.uk%';
update public.approved_domains set feed_url = 'https://www.belfasttelegraph.co.uk/feed/' where domain ilike '%belfasttelegraph.co.uk%';
update public.approved_domains set feed_url = 'https://www.irishnews.com/rss/news.xml' where domain ilike '%irishnews.com%';

-- UK REGIONAL ENGLISH
update public.approved_domains set feed_url = 'https://www.manchestereveningnews.co.uk/news/rss.xml' where domain ilike '%manchestereveningnews.co.uk%';
update public.approved_domains set feed_url = 'https://www.liverpoolecho.co.uk/news/rss.xml' where domain ilike '%liverpoolecho.co.uk%';
update public.approved_domains set feed_url = 'https://www.yorkshirepost.co.uk/feed' where domain ilike '%yorkshirepost.co.uk%';
update public.approved_domains set feed_url = 'https://www.chroniclelive.co.uk/news/rss.xml' where domain ilike '%chroniclelive.co.uk%';
update public.approved_domains set feed_url = 'https://www.bristolpost.co.uk/news/rss.xml' where domain ilike '%bristolpost.co.uk%';

-- IRELAND
update public.approved_domains set feed_url = 'https://www.irishtimes.com/cmlink/news-1.1319192' where domain ilike '%irishtimes.com%';
update public.approved_domains set feed_url = 'https://www.independent.ie/rss/' where domain ilike '%independent.ie%';
update public.approved_domains set feed_url = 'https://www.rte.ie/news/rss/rte-newsheadlines.xml' where domain ilike '%rte.ie%';
update public.approved_domains set feed_url = 'https://www.thejournal.ie/feed/' where domain ilike '%thejournal.ie%';
update public.approved_domains set feed_url = 'https://www.irishexaminer.com/feed/' where domain ilike '%irishexaminer.com%';
update public.approved_domains set feed_url = 'https://www.businesspost.ie/feed/' where domain ilike '%businesspost.ie%';

-- WIRE SERVICES
update public.approved_domains set feed_url = 'https://feeds.reuters.com/reuters/topNews' where domain ilike '%reuters.com%';
update public.approved_domains set feed_url = 'https://rss.app/feeds/2i4CkHpkpxBRfMuS.xml' where domain ilike '%apnews.com%';
update public.approved_domains set feed_url = 'https://www.dw.com/en/rss/rss.xml' where domain ilike '%dw.com%';

-- NORDIC — SWEDEN
update public.approved_domains set feed_url = 'https://www.dn.se/rss/' where domain ilike '%dn.se%';
update public.approved_domains set feed_url = 'https://www.svd.se/feed/articles.rss' where domain ilike '%svd.se%';
update public.approved_domains set feed_url = 'https://www.di.se/rss' where domain ilike '%di.se%';
update public.approved_domains set feed_url = 'https://www.aftonbladet.se/rss.xml' where domain ilike '%aftonbladet.se%';
update public.approved_domains set feed_url = 'https://www.expressen.se/rss/nyheter/' where domain ilike '%expressen.se%';
update public.approved_domains set feed_url = 'https://www.gp.se/feed' where domain ilike '%gp.se%';
update public.approved_domains set feed_url = 'https://www.nyteknik.se/feed' where domain ilike '%nyteknik.se%';

-- NORDIC — NORWAY
update public.approved_domains set feed_url = 'https://www.aftenposten.no/rss/nyheter' where domain ilike '%aftenposten.no%';
update public.approved_domains set feed_url = 'https://e24.no/rss/nyheter' where domain ilike '%e24.no%';
update public.approved_domains set feed_url = 'https://www.dn.no/rss' where domain ilike '%dn.no%';
update public.approved_domains set feed_url = 'https://www.vg.no/rss/feed/?limit=10&categories=1069' where domain ilike '%vg.no%';
update public.approved_domains set feed_url = 'https://www.nrk.no/toppsaker.rss' where domain ilike '%nrk.no%';
update public.approved_domains set feed_url = 'https://www.tu.no/rss' where domain ilike '%tu.no%';
update public.approved_domains set feed_url = 'https://sysla.no/feed/' where domain ilike '%sysla.no%';

-- NORDIC — DENMARK
update public.approved_domains set feed_url = 'https://www.berlingske.dk/rss/allenyheder' where domain ilike '%berlingske.dk%';
update public.approved_domains set feed_url = 'https://politiken.dk/rss/seneste' where domain ilike '%politiken.dk%';
update public.approved_domains set feed_url = 'https://borsen.dk/rss' where domain ilike '%borsen.dk%';
update public.approved_domains set feed_url = 'https://www.dr.dk/nyheder/service/feeds/allenyheder' where domain ilike '%dr.dk%';
update public.approved_domains set feed_url = 'https://jyllands-posten.dk/rss' where domain ilike '%jyllands-posten.dk%';

-- NORDIC — FINLAND
update public.approved_domains set feed_url = 'https://www.hs.fi/rss/tuoreimmat.xml' where domain ilike '%hs.fi%';
update public.approved_domains set feed_url = 'https://yle.fi/uutiset/rss/uutiset.rss' where domain ilike '%yle.fi%';
update public.approved_domains set feed_url = 'https://www.kauppalehti.fi/rss.xml' where domain ilike '%kauppalehti.fi%';

-- EUROPE — GERMANY
update public.approved_domains set feed_url = 'https://www.spiegel.de/international/index.rss' where domain ilike '%spiegel.de%';
update public.approved_domains set feed_url = 'https://www.faz.net/rss/aktuell/' where domain ilike '%faz.net%';
update public.approved_domains set feed_url = 'https://rss.sueddeutsche.de/rss/Topthemen' where domain ilike '%sueddeutsche.de%';
update public.approved_domains set feed_url = 'https://newsfeed.zeit.de/index' where domain ilike '%zeit.de%';
update public.approved_domains set feed_url = 'https://www.handelsblatt.com/rss' where domain ilike '%handelsblatt.com%';
update public.approved_domains set feed_url = 'https://www.welt.de/feeds/topnews.rss' where domain ilike '%welt.de%';
update public.approved_domains set feed_url = 'https://www.derstandard.at/feed' where domain ilike '%derstandard.at%';

-- EUROPE — FRANCE & BELGIUM
update public.approved_domains set feed_url = 'https://www.lemonde.fr/rss/une.xml' where domain ilike '%lemonde.fr%';
update public.approved_domains set feed_url = 'https://www.lefigaro.fr/rss/figaro_actualites.xml' where domain ilike '%lefigaro.fr%';
update public.approved_domains set feed_url = 'https://www.lesechos.fr/rss/rss_une.xml' where domain ilike '%lesechos.fr%';
update public.approved_domains set feed_url = 'https://www.liberation.fr/arc/outboundfeeds/rss/' where domain ilike '%liberation.fr%';
update public.approved_domains set feed_url = 'https://www.france24.com/en/rss' where domain ilike '%france24.com%';
update public.approved_domains set feed_url = 'https://www.latribune.fr/rss/une.html' where domain ilike '%latribune.fr%';
update public.approved_domains set feed_url = 'https://www.lesoir.be/arc/outboundfeeds/rss/' where domain ilike '%lesoir.be%';
update public.approved_domains set feed_url = 'https://www.rtbf.be/rss/info/generale' where domain ilike '%rtbf.be%';

-- EUROPE — NETHERLANDS
update public.approved_domains set feed_url = 'https://www.nrc.nl/rss/' where domain ilike '%nrc.nl%';
update public.approved_domains set feed_url = 'https://www.volkskrant.nl/nieuws-achtergrond/rss.xml' where domain ilike '%volkskrant.nl%';
update public.approved_domains set feed_url = 'https://fd.nl/rss' where domain ilike '%fd.nl%';
update public.approved_domains set feed_url = 'https://feeds.nos.nl/nosnieuwsalgemeen' where domain ilike '%nos.nl%';

-- EUROPE — SPAIN & PORTUGAL
update public.approved_domains set feed_url = 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' where domain ilike '%elpais.com%';
update public.approved_domains set feed_url = 'https://www.elmundo.es/rss/portada.xml' where domain ilike '%elmundo.es%';
update public.approved_domains set feed_url = 'https://e00-elmundo.uecdn.es/rss/portada.xml' where domain ilike '%expansion.com%';
update public.approved_domains set feed_url = 'https://www.publico.pt/feed' where domain ilike '%publico.pt%';
update public.approved_domains set feed_url = 'https://www.dn.pt/rss' where domain ilike '%dn.pt%';
update public.approved_domains set feed_url = 'https://expresso.pt/rss' where domain ilike '%expresso.pt%';

-- EUROPE — ITALY
update public.approved_domains set feed_url = 'https://www.corriere.it/rss/homepage.xml' where domain ilike '%corriere.it%';
update public.approved_domains set feed_url = 'https://www.repubblica.it/rss/homepage/rss2.0.xml' where domain ilike '%repubblica.it%';
update public.approved_domains set feed_url = 'https://www.ilsole24ore.com/rss/italia--mondo.xml' where domain ilike '%ilsole24ore.com%';
update public.approved_domains set feed_url = 'https://www.lastampa.it/feed' where domain ilike '%lastampa.it%';
update public.approved_domains set feed_url = 'https://www.ansa.it/sito/notizie/politica/politica_rss.xml' where domain ilike '%ansa.it%';

-- PAN-EUROPEAN
update public.approved_domains set feed_url = 'https://www.euractiv.com/feed/' where domain ilike '%euractiv.com%';
update public.approved_domains set feed_url = 'https://www.politico.eu/feed/' where domain ilike '%politico.eu%';
update public.approved_domains set feed_url = 'https://euronews.com/rss?format=mrss&level=theme&name=news' where domain ilike '%euronews.com%';
update public.approved_domains set feed_url = 'https://euobserver.com/rss.xml' where domain ilike '%euobserver.com%';

-- ENERGY SPECIALIST PRESS
update public.approved_domains set feed_url = 'https://www.rechargenews.com/rss' where domain ilike '%rechargenews.com%';
update public.approved_domains set feed_url = 'https://www.energymonitor.ai/feed' where domain ilike '%energymonitor.ai%';
update public.approved_domains set feed_url = 'https://www.windpowermonthly.com/rss' where domain ilike '%windpowermonthly.com%';
update public.approved_domains set feed_url = 'https://www.businessgreen.com/feed' where domain ilike '%businessgreen.com%';
update public.approved_domains set feed_url = 'https://www.edie.net/rss/' where domain ilike '%edie.net%';
update public.approved_domains set feed_url = 'https://www.current-news.co.uk/feed' where domain ilike '%current-news.co.uk%';
update public.approved_domains set feed_url = 'https://www.theenergyst.com/feed/' where domain ilike '%theenergyst.com%';
update public.approved_domains set feed_url = 'https://www.newscientist.com/feed/home/' where domain ilike '%newscientist.com%';
update public.approved_domains set feed_url = 'https://www.offshore-technology.com/feed/' where domain ilike '%offshore-technology.com%';
update public.approved_domains set feed_url = 'https://www.pv-magazine.com/feed/' where domain ilike '%pv-magazine.com%';
update public.approved_domains set feed_url = 'https://www.4coffshore.com/rss' where domain ilike '%4coffshore.com%';

-- Set all with feed_url as active
update public.approved_domains set active = true where feed_url is not null;

-- Re-enable triggers
ALTER TABLE public.approved_domains ENABLE TRIGGER ALL;
