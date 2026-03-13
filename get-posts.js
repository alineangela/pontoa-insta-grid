// netlify/functions/get-posts.js
// Busca todos os dados de uma única base de dados com Tipo = Perfil | Destaque | Post
// Ordenação de destaques: propriedade "Ordem" (número) → fallback: posição natural na base

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
    // Busca sem sort forçado para preservar a ordem natural da base de dados
    // (usada como fallback para destaques sem propriedade Ordem preenchida)
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

    function getImage(props, page) {
      const fileProp =
        props['Imagem'] || props['Image'] || props['Capa'] || props['Cover'] ||
        Object.values(props).find(p => p.type === 'files');

      let imageUrl = null, imageType = 'none';

      if (fileProp?.files?.length > 0) {
        const f = fileProp.files[0];
        imageUrl  = f.type === 'external' ? f.external.url : f.file?.url;
        imageType = 'file';
      }

      if (!imageUrl) {
        const urlProp =
          props['Link'] || props['URL'] ||
          Object.values(props).find(p => p.type === 'url');
        if (urlProp?.url) {
          imageUrl  = urlProp.url;
          imageType = imageUrl.includes('canva.com') ? 'canva' : 'url';
        }
      }

      if (!imageUrl && page.cover) {
        imageUrl  = page.cover.type === 'external'
          ? page.cover.external.url
          : page.cover.file?.url;
        imageType = 'cover';
      }

      return { imageUrl, imageType };
    }

    function isPinned(props) {
      const fixarProp =
        props['Fixar'] || props['Pin'] || props['Fixado'];
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

    // A API retorna na ordem natural da view padrão da base.
    // Guardamos o índice de posição para usar como fallback de ordenação.
    data.results.forEach((page, naturalIndex) => {
      const props = page.properties;
      const tipo  = getSel(props['Tipo'] || props['Type']) || 'Post';

      const titleProp =
        props['Nome'] || props['Name'] || props['Título'] || props['Title'] ||
        Object.values(props).find(p => p.type === 'title');
      const nome = getTitle(titleProp);

      const { imageUrl, imageType } = getImage(props, page);

      if (tipo === 'Perfil') {
        perfil = {
          nome,
          bio:        getText(props['Bio'] || props['Biografia']),
          link:       getUrl(props['Link'] || props['URL']),
          seguidores: getNum(props['Seguidores'] || props['Followers']),
          seguindo:   getNum(props['Seguindo']   || props['Following']),
          imageUrl,
          imageType
        };

      } else if (tipo === 'Destaque') {
        const ordemProp = props['Ordem'] || props['Order'];
        const ordem     = getNum(ordemProp);

        destaques.push({
          id:           page.id,
          nome,
          descricao:    getText(
            props['Descrição do Destaque'] ||
            props['Descrição'] ||
            props['Description']
          ),
          // Se Ordem estiver preenchida usa ela; senão usa posição natural
          // multiplicada por 1000 para nunca conflitar com valores reais
          ordem:        ordem !== null ? ordem : naturalIndex * 1000,
          ordemManual:  ordem !== null, // flag: foi preenchido manualmente?
          imageUrl,
          imageType
        });

      } else {
        // Post (valor padrão quando Tipo não está preenchido)
        const dateProp =
          props['Data'] || props['Data de publicação'] ||
          props['Publish Date'] || props['Date'] ||
          Object.values(props).find(p => p.type === 'date');

        const legendaProp =
          props['Legenda'] || props['Caption'] ||
          // evita pegar Bio por engano — só pega rich_text que não seja Bio
          Object.values(props).find(p =>
            p.type === 'rich_text' &&
            !['Bio','Biografia','Descrição do Destaque','Descrição'].includes(
              Object.keys(props).find(k => props[k] === p)
            )
          );

        posts.push({
          id:        page.id,
          title:     nome,
          legenda:   getText(legendaProp),
          date:      getDate(dateProp),
          imageUrl,
          imageType,
          pinned:    isPinned(props)
        });
      }
    });

    // ── Ordenações finais ────────────────────────────────────────────────

    // Destaques: por ordem (numérica, já com fallback de posição natural)
    destaques.sort((a, b) => a.ordem - b.ordem);

    // Posts: por data descendente
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
