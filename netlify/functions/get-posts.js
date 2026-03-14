// netlify/functions/get-posts.js
// Busca todos os dados de uma única base de dados com Tipo = Perfil | Destaque | Post
// Prioridade de imagem: canvaUrl > imageUrl

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

    function getMedia(props, page) {
      // Tenta primeiro a propriedade de arquivo (imagem enviada diretamente)
      const fileProp =
        props['Imagem'] || props['Image'] || props['Capa'] || props['Cover'] ||
        Object.values(props).find(p => p.type === 'files');

      let imageUrl  = null;
      let canvaUrl  = null;

      if (fileProp?.files?.length > 0) {
        const f = fileProp.files[0];
        imageUrl = f.type === 'external' ? f.external.url : f.file?.url;
      }

      // Tenta propriedade URL — separa Canva de imagem comum
      const urlProp =
        props['Link'] || props['URL'] ||
        Object.values(props).find(p => p.type === 'url');

      if (urlProp?.url) {
        const u = urlProp.url;
        if (u.includes('canva.com')) {
          canvaUrl = u; // guarda separado — tem prioridade no display
        } else if (!imageUrl) {
          imageUrl = u; // só usa como imagem se não tiver arquivo
        }
      }

      // Fallback: capa da página no Notion
      if (!imageUrl && !canvaUrl && page.cover) {
        imageUrl = page.cover.type === 'external'
          ? page.cover.external.url
          : page.cover.file?.url;
      }

      return { imageUrl, canvaUrl };
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

      const { imageUrl, canvaUrl } = getMedia(props, page);

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
        const ordemProp = props['Ordem'] || props['Order'];
        destaques.push({
          id:        page.id,
          nome,
          descricao: getText(props['Descrição do Destaque'] || props['Descrição'] || props['Description']),
          ordem:     getNum(ordemProp) !== null ? getNum(ordemProp) : naturalIndex * 1000,
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
          imageUrl,
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
