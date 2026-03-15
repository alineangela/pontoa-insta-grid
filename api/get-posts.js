// api/get-posts.js — Vercel Serverless Function (CommonJS)
// Retorna: perfil, destaques, posts (Feed+Reels com Mostrar no Feed), reels

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 3 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  const token = process.env.NOTION_TOKEN;
  const dbId  = process.env.NOTION_DATABASE_ID;
  if (!token || !dbId) return res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 })
    });
    if (!response.ok) return res.status(response.status).json(await response.json());
    const data = await response.json();

    const getText  = p => p?.rich_text?.map(t => t.plain_text).join('') || '';
    const getTitle = p => p?.title?.map(t => t.plain_text).join('') || '';
    const getDate  = p => p?.date?.start || null;
    const getNum   = p => p?.number != null ? p.number : null;
    const getUrl   = p => p?.url || null;
    const getSel   = p => p?.select?.name || null;

    function getAllMedia(props, page) {
      const fileProp =
        props['Imagem'] || props['Imagens'] || props['Image'] || props['Images'] ||
        props['Capa'] || props['Cover'] ||
        Object.values(props).find(p => p.type === 'files');
      const items = [];
      if (fileProp?.files?.length > 0) {
        for (const f of fileProp.files) {
          const url = f.type === 'external' ? f.external.url : f.file?.url;
          const name = f.name || '';
          const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(name);
          if (url) items.push({ url, type: isVideo ? 'video' : 'image' });
        }
      }
      if (items.length === 0 && page.cover) {
        const url = page.cover.type === 'external' ? page.cover.external.url : page.cover.file?.url;
        if (url) items.push({ url, type: 'image' });
      }
      return items;
    }

    function getCanvaUrl(props) {
      const urlProp = props['Link'] || props['URL'] || Object.values(props).find(p => p.type === 'url');
      if (!urlProp?.url) return null;
      return urlProp.url.includes('canva.com') ? urlProp.url : null;
    }

    function getNonCanvaUrl(props) {
      const urlProp = props['Link'] || props['URL'] || Object.values(props).find(p => p.type === 'url');
      if (!urlProp?.url) return null;
      return !urlProp.url.includes('canva.com') ? urlProp.url : null;
    }

    // Feed property: "Fixar" = pin no feed, "Mostrar no Feed" = aparece no grid
    function getFeedStatus(props) {
      const feedProp = props['Feed'] || props['Fixar'] || props['Pin'];
      if (!feedProp) return null;
      const val = (feedProp.select?.name || '').toLowerCase();
      if (val === 'fixar' || val === 'pin' || val === 'fixado' || val === 'pinned') return 'fixar';
      if (val === 'mostrar no feed' || val === 'mostrar' || val === 'show in feed') return 'mostrar';
      return null;
    }

    let perfil = null;
    const destaques = [];
    const posts = [];
    const reels = [];

    data.results.forEach((page, naturalIndex) => {
      const props = page.properties;
      const tipo  = getSel(props['Tipo'] || props['Type']) || 'Post';
      const titleProp = props['Nome'] || props['Name'] || props['Título'] || props['Title'] ||
        Object.values(props).find(p => p.type === 'title');
      const nome    = getTitle(titleProp);
      const media   = getAllMedia(props, page);
      const canvaUrl = getCanvaUrl(props);
      const imageUrl = media.find(m => m.type === 'image')?.url || getNonCanvaUrl(props) || null;
      const feedStatus = getFeedStatus(props);

      const dateProp = props['Data'] || props['Data de publicação'] || props['Publish Date'] || props['Date'] ||
        Object.values(props).find(p => p.type === 'date');
      const legendaProp = props['Legenda'] || props['Caption'] ||
        Object.values(props).find(p => p.type === 'rich_text' &&
          !['Bio','Biografia','Descrição do Destaque','Descrição'].includes(Object.keys(props).find(k => props[k] === p)));

      const baseItem = {
        id: page.id, title: nome,
        legenda: getText(legendaProp),
        date: getDate(dateProp),
        media, imageUrl, canvaUrl,
        pinned: feedStatus === 'fixar',
        feedStatus
      };

      if (tipo === 'Perfil') {
        perfil = { nome, bio: getText(props['Bio'] || props['Biografia']), link: getUrl(props['Link'] || props['URL']),
          seguidores: getNum(props['Seguidores'] || props['Followers']), seguindo: getNum(props['Seguindo'] || props['Following']),
          imageUrl, canvaUrl };
      } else if (tipo === 'Destaque') {
        destaques.push({ id: page.id, nome,
          descricao: getText(props['Descrição do Destaque'] || props['Descrição'] || props['Description']),
          ordem: getNum(props["Ordem"] || props["Order"]) !== null ? getNum(props["Ordem"] || props["Order"]) : naturalIndex * 1000, imageUrl, canvaUrl });
      } else if (tipo === 'Reels' || tipo === 'Reel') {
        reels.push(baseItem);
        // Reels com "Mostrar no Feed" também aparecem no grid
        if (feedStatus === 'mostrar' || feedStatus === 'fixar') {
          posts.push(baseItem);
        }
      } else {
        posts.push(baseItem);
      }
    });

    destaques.sort((a, b) => a.ordem - b.ordem);
    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    reels.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const result = { perfil, destaques, posts, reels };
    cache = result; cacheTime = Date.now();
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
