// netlify/functions/mural.js
// GET  /api/mural          → retorna últimas 80 mensagens
// POST /api/mural          → adiciona nova mensagem { name, text, av }

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS mural (
      id         SERIAL PRIMARY KEY,
      name       TEXT        NOT NULL,
      text       TEXT        NOT NULL,
      av         TEXT        NOT NULL DEFAULT '🚣',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// Sanitiza string: remove tags HTML, limita tamanho
function sanitize(str, max = 200) {
  return String(str || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, max);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    await initTable();

    // ── GET: retorna mensagens ordenadas por data ──
    if (event.httpMethod === "GET") {
      const rows = await sql`
        SELECT id, name, text, av,
               EXTRACT(EPOCH FROM created_at) * 1000 AS time
        FROM mural
        ORDER BY created_at DESC
        LIMIT 80
      `;
      // Retorna em ordem cronológica (mais antigas primeiro)
      const msgs = rows.reverse().map((r) => ({
        id:   r.id,
        name: r.name,
        text: r.text,
        av:   r.av,
        time: Number(r.time),
      }));
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(msgs),
      };
    }

    // ── POST: adiciona nova mensagem ──
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const name = sanitize(body.name || "Anônimo", 30);
      const text = sanitize(body.text || "", 120);
      const av   = sanitize(body.av   || "🚣",  10);

      if (!text) {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ error: "Mensagem vazia" }),
        };
      }

      // Rate limit simples: máx 5 mensagens por nome nos últimos 5 min
      const [{ c }] = await sql`
        SELECT COUNT(*) as c FROM mural
        WHERE name = ${name}
          AND created_at > NOW() - INTERVAL '5 minutes'
      `;
      if (Number(c) >= 5) {
        return {
          statusCode: 429,
          headers: CORS,
          body: JSON.stringify({ error: "Calma aí! Muitas mensagens em sequência 😅" }),
        };
      }

      const [inserted] = await sql`
        INSERT INTO mural (name, text, av)
        VALUES (${name}, ${text}, ${av})
        RETURNING id, name, text, av,
                  EXTRACT(EPOCH FROM created_at) * 1000 AS time
      `;
      return {
        statusCode: 201,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          id:   inserted.id,
          name: inserted.name,
          text: inserted.text,
          av:   inserted.av,
          time: Number(inserted.time),
        }),
      };
    }

    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  } catch (err) {
    console.error("mural error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Erro interno", detail: err.message }),
    };
  }
};
