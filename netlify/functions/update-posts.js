// netlify/functions/update-posts.js
// Recebe o novo array de {id, date} e atualiza as datas no Notion

exports.handler = async (event) => {
  // Responde preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método não permitido' };
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'NOTION_TOKEN não configurado.' }) };
  }

  let updates;
  try {
    updates = JSON.parse(event.body); // esperado: [{id, date}, ...]
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido.' }) };
  }

  // Nome da propriedade de data no seu banco — ajuste se necessário
  const DATE_PROPERTY = process.env.NOTION_DATE_PROPERTY || 'Data';

  try {
    const results = await Promise.all(
      updates.map(({ id, date }) =>
        fetch(`https://api.notion.com/v1/pages/${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              [DATE_PROPERTY]: date ? { date: { start: date } } : { date: null }
            }
          })
        }).then(r => ({ id, ok: r.ok, status: r.status }))
      )
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ ok: true, results })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
