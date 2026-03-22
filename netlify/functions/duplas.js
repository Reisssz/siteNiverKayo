// netlify/functions/duplas.js
// GET  /api/duplas        → retorna estado de todas as duplas
// PUT  /api/duplas        → confirma uma dupla  { id, confirmedBy }

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL);

// Inicializa tabela se não existir
async function initTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS duplas (
      id          INTEGER PRIMARY KEY,
      confirmada  BOOLEAN  NOT NULL DEFAULT FALSE,
      confirmed_at TIMESTAMPTZ,
      confirmed_by TEXT
    )
  `;
  // Insere as 6 duplas iniciais se a tabela estiver vazia
  const existing = await sql`SELECT COUNT(*) as c FROM duplas`;
  if (Number(existing[0].c) === 0) {
    for (let i = 1; i <= 6; i++) {
      await sql`
        INSERT INTO duplas (id, confirmada)
        VALUES (${i}, FALSE)
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    await initTable();

    // ── GET: retorna todas as duplas ──
    if (event.httpMethod === "GET") {
      const rows = await sql`SELECT * FROM duplas ORDER BY id`;
      // Transforma em objeto { 1: {...}, 2: {...}, ... }
      const duplas = {};
      rows.forEach((r) => {
        duplas[r.id] = {
          id: r.id,
          confirmada: r.confirmada,
          confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
          confirmedBy: r.confirmed_by,
        };
      });
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(duplas),
      };
    }

    // ── PUT: confirma uma dupla ──
    if (event.httpMethod === "PUT") {
      const { id, confirmedBy } = JSON.parse(event.body || "{}");
      if (!id || id < 1 || id > 6) {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ error: "ID inválido" }),
        };
      }

      // Checa se já confirmada
      const [current] = await sql`SELECT confirmada FROM duplas WHERE id = ${id}`;
      if (current?.confirmada) {
        return {
          statusCode: 409,
          headers: CORS,
          body: JSON.stringify({ error: "Dupla já confirmada" }),
        };
      }

      const [updated] = await sql`
        UPDATE duplas
        SET confirmada    = TRUE,
            confirmed_at  = NOW(),
            confirmed_by  = ${confirmedBy || "visitante"}
        WHERE id = ${id}
        RETURNING *
      `;
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: updated.id,
          confirmada: updated.confirmada,
          confirmedAt: updated.confirmed_at.toISOString(),
          confirmedBy: updated.confirmed_by,
        }),
      };
    }

    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  } catch (err) {
    console.error("duplas error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Erro interno", detail: err.message }),
    };
  }
};
