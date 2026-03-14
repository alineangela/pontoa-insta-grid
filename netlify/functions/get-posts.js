// netlify/functions/get-posts.js
// Retorna perfil, destaques e posts de uma única base de dados Notion.
// Posts incluem array completo de imagens para carrossel.

exports.handler = async () => {
  const token = process.env.NOTION_TOKEN;
  const dbId  = process.env.NOTION_DATABASE_ID;

  if (!token || !dbId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Variáveis de ambiente não configuradas.' })
    };
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });

    if (!res.ok) {
      const err = await res.json();
      return { statusCode: res.status, body: JSON.stringify(err) };
    }

    const data = await res.json();

    // ── Helpers ──────────────────────────────────────────────────────────
    const getText  = p => p?.rich_text?.map(t => t.plain_text).join('') || '';
    const getTitle = p => p?.title?.map(t => t.plain_text).join('') || '';
    const getDate  = p => p?.date?.start || null;
    const getNum   = p => (p?.number != null) ? p.number : null;
    const getUrl   = p => p?.url || null;
    const getSel   = p => p?.select?.name || null;

    // Retorna TODOS os arquivos de uma propriedade como array de URLs
    function getAllImages(props, page) {
      const fileProp =
        props['Imagem'] || props['Imagens'] || props['Image'] || props['Images'] ||
        props['Capa']   || props['Cover']   ||
        Object.values(props).find(p => p.type === 'files');

      const images = [];

      if (fileProp?.files?.length > 0) {
        for (const f of fileProp.files) {
          const url = f.type === 'external' ? f.external.url : f.file?.url;
          if (url) images.push(url);
        }
      }

      // Fallback: capa da página no Notion
      if (images.length === 0 && page.cover) {
        const url = page.cover.type === 'external'
          ? page.cover.external.url
          : page.cover.file?.url;
        if (url) images.push(url);
      }

      return images; // array completo — pode ter múltiplas imagens
    }

    function getCanvaUrl(props) {
      const urlProp =
        props['Link'] || props['URL'] ||
        Object.values(props).find(p => p.type === 'url');
      if (!urlProp?.url) return null;
      return urlProp.url.includes('canva.com') ? urlProp.url : null;
    }

    function getNonCanvaUrl(props) {
      const urlProp =
        props['Link'] || props['URL'] ||
        Object.values(props).find(p => p.type === 'url');
      if (!urlProp?.url) return null;
      return !urlProp.url.includes('canva.com') ? urlProp.url : null;
    }

    function isPinned(props) {
      const fixarProp = props['Fixar'] || props['Pin'] || props['Fixado'];
      if (!fixarProp) return false;
      const VALS = ['fixar','pin','fixado','pinned'];
      if (fixarProp.type === 'select')
        return VALS.includes((fixarProp.select?.name || '').toLowerCase());
      if (fixarProp.type === 'multi_select')
        return (fixarProp.multi_select || [])
          .some(o => VALS.includes(o.name.toLowerCase()));
      return false;
    }

    // ── Separar por Tipo ─────────────────────────────────────────────────
    let perfil      = null;
    const destaques = [];
    const posts     = [];

    data.results.forEach((page, naturalIndex) => {
      const props = page.properties;
      const tipo  = getSel(props['Tipo'] || props['Type']) || 'Post';

      const titleProp =
        props['Nome'] || props['Name'] || props['Título'] || props['Title'] ||
        Object.values(props).find(p => p.type === 'title');
      const nome = getTitle(titleProp);

      const images   = getAllImages(props, page);
      const canvaUrl = getCanvaUrl(props);

      // imageUrl: primeira imagem do array, ou URL externa não-Canva
      let imageUrl = images[0] || getNonCanvaUrl(props) || null;

      if (tipo === 'Perfil') {
        perfil = {
          nome,
          bio:        getText(props['Bio'] || props['Biografia']),
          link:       getUrl(props['Link'] || props['URL']),
          seguidores: getNum(props['Seguidores'] || props['Followers']),
          seguindo:   getNum(props['Seguindo']   || props['Following']),
          imageUrl,
          canvaUrl
        };

      } else if (tipo === 'Destaque') {
        destaques.push({
          id:        page.id,
          nome,
          descricao: getText(props['Descrição do Destaque'] || props['Descrição'] || props['Description']),
          ordem:     getNum(props['Ordem'] || props['Order']) !== null
                       ? getNum(props['Ordem'] || props['Order'])
                       : naturalIndex * 1000,
          imageUrl,
          canvaUrl
        });

      } else {
        const dateProp =
          props['Data'] || props['Data de publicação'] ||
          props['Publish Date'] || props['Date'] ||
          Object.values(props).find(p => p.type === 'date');

        const legendaProp =
          props['Legenda'] || props['Caption'] ||
          Object.values(props).find(p =>
            p.type === 'rich_text' &&
            !['Bio','Biografia','Descrição do Destaque','Descrição'].includes(
              Object.keys(props).find(k => props[k] === p)
            )
          );

        posts.push({
          id:       page.id,
          title:    nome,
          legenda:  getText(legendaProp),
          date:     getDate(dateProp),
          images,        // array completo de imagens
          imageUrl,      // primeira imagem (atalho)
          canvaUrl,
          pinned:   isPinned(props)
        });
      }
    });

    destaques.sort((a, b) => a.ordem - b.ordem);
    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ perfil, destaques, posts })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
