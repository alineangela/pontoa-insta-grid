// api/update-posts.js
// Vercel Serverless Function
// Atualiza datas dos posts no Notion após reordenação

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN não configurado.' });

  const DATE_PROPERTY = process.env.NOTION_DATE_PROPERTY || 'Data';

  let updates;
  try {
    updates = req.body;
    if (!Array.isArray(updates)) throw new Error('Body inválido');
  } catch {
    return res.status(400).json({ error: 'Body inválido.' });
  }

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

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
